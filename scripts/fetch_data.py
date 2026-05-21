#!/usr/bin/env python3
"""
fetch_data.py — Buffett Tracker data pipeline
Fetches Berkshire Hathaway's latest 13F-HR filing from SEC EDGAR,
enriches it with stock prices via yfinance, and writes data/portfolio.json.

Run:  python3 scripts/fetch_data.py
Deps: pip install requests yfinance lxml
"""

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

import requests
import yfinance as yf

# ── Constants ────────────────────────────────────────────────────────────────
BERKSHIRE_CIK = "0001067983"
EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/"
OUTPUT_PATH = Path(__file__).parent.parent / "data" / "portfolio.json"

HEADERS = {
    "User-Agent": "BuffettTracker research@example.com",
    "Accept-Encoding": "gzip, deflate",
}

CUSIP_TO_TICKER = {
    "037833100": "AAPL",
    "025816109": "AXP",
    "060505104": "BAC",
    "191216100": "KO",
    "166764100": "CVX",
    "674599105": "OXY",
    "615369105": "MCO",
    "500754106": "KHC",
    "125523100": "CB",
    "23918K108": "DVA",
    "064058100": "BK",
    "92343V104": "VZ",
    "82900D109": "SIRI",
    "172967424": "C",
    "67066G104": "NU",
    "90384S303": "ULTA",
    "546347105": "LPX",
    "018972101": "ALLY",
    "14040H105": "COF",
    "530307305": "FWONK",
    "931142103": "WMT",
    "459200101": "IBM",
    "717081103": "PFE",
    "084670702": "BRK.B",
    "693718108": "PG",
    "418056107": "HPQ",
    "097023105": "BNY",
    "29379V103": "ENB",
    "084670207": "BRK.A",
    "857477103": "STZ",
    "741503207": "PSX",
    "742718109": "PGR",
}

SECTOR_MAP = {
    "AAPL": "Technology", "AXP": "Financials", "BAC": "Financials",
    "KO": "Consumer Staples", "CVX": "Energy", "OXY": "Energy",
    "MCO": "Financials", "KHC": "Consumer Staples", "CB": "Financials",
    "DVA": "Healthcare", "BK": "Financials", "VZ": "Communication Services",
    "SIRI": "Communication Services", "C": "Financials", "NU": "Financials",
    "ULTA": "Consumer Discretionary", "LPX": "Materials", "ALLY": "Financials",
    "COF": "Financials", "FWONK": "Communication Services",
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ── EDGAR Helpers ─────────────────────────────────────────────────────────────

def get_latest_13f_accession():
    """Return (accession_no, filing_date, period_of_report) for the latest 13F-HR."""
    log("Fetching EDGAR submissions index...")
    url = (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        "?action=getcompany&CIK=0001067983&type=13F-HR"
        "&dateb=&owner=include&count=5&output=atom"
    )
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    accessions = re.findall(r'<accession-number>(\d{10}-\d{2}-\d{6})</accession-number>', resp.text)
    dates = re.findall(r'<filing-date>(\d{4}-\d{2}-\d{2})</filing-date>', resp.text)

    if not accessions:
        raise RuntimeError("No 13F-HR filing found on EDGAR company page")

    acc_fmt = accessions[0]
    acc_no = acc_fmt.replace("-", "")
    filing_date = dates[0] if dates else "2025-02-14"

    fd = datetime.strptime(filing_date, "%Y-%m-%d")
    month = fd.month
    if month <= 2:
        period = f"{fd.year - 1}-12-31"
    elif month <= 5:
        period = f"{fd.year}-03-31"
    elif month <= 8:
        period = f"{fd.year}-06-30"
    else:
        period = f"{fd.year}-09-30"

    log(f"Latest 13F: {acc_fmt} filed {filing_date}, period {period}")
    return acc_no, acc_fmt, filing_date, period


def find_holdings_xml_url(cik: str, accession_no: str) -> str:
    """Find the URL of the primary 13F holdings XML file within the filing."""
    cik_short = cik.lstrip("0")
    folder = accession_no[:10] + "-" + accession_no[10:12] + "-" + accession_no[12:]
    base = f"{EDGAR_ARCHIVES}data/{cik_short}/{accession_no}/"

    index_html_url = f"{base}{folder}-index.htm"
    log(f"Scanning filing index for XML: {index_html_url}")
    resp = requests.get(index_html_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    matches = re.findall(r'href="(/Archives/edgar/data/[^"]+\.xml)"', resp.text, re.I)

    # Only keep root-level files (no subdirectory after accession folder)
    root_xmls = []
    for m in matches:
        after_accession = m.split(accession_no)[-1]
        if after_accession.count("/") == 1:
            root_xmls.append(m)

    for m in root_xmls:
        if "primary_doc" not in m.lower():
            return "https://www.sec.gov" + m

    if root_xmls:
        return "https://www.sec.gov" + root_xmls[0]

    raise RuntimeError("Could not find holdings XML in filing index")


def parse_13f_xml(xml_text: str) -> list[dict]:
    """Parse 13F-HR infoTable XML into a list of holding dicts."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log(f"XML parse error: {e}")
        return []

    ns_match = re.search(r'xmlns="([^"]+)"', xml_text)
    ns_uri = ns_match.group(1) if ns_match else ""

    def find_text(el, tag):
        child = el.find(f"{{{ns_uri}}}{tag}") if ns_uri else None
        if child is None:
            child = el.find(tag)
        return child.text.strip() if child is not None and child.text else ""

    def find_el(el, *path):
        for tag in path:
            ns_tag = f"{{{ns_uri}}}{tag}" if ns_uri else tag
            child = el.find(ns_tag)
            if child is None:
                child = el.find(tag)
            if child is None:
                return None
            el = child
        return el

    holdings = []
    ns_infoTable = f"{{{ns_uri}}}infoTable" if ns_uri else "infoTable"

    for table in root.iter(ns_infoTable):
        cusip = find_text(table, "cusip")
        ticker = CUSIP_TO_TICKER.get(cusip, "")
        name = find_text(table, "nameOfIssuer")
        value_str = find_text(table, "value")
        shares_el = find_el(table, "shrsOrPrnAmt", "sshPrnamt")
        shares_str = shares_el.text.strip() if shares_el is not None and shares_el.text else "0"

        try:
            value = int(value_str.replace(",", "")) // 1000 if value_str else 0
            shares = int(shares_str.replace(",", "")) if shares_str else 0
        except ValueError:
            value, shares = 0, 0

        if shares > 0:
            holdings.append({
                "cusip": cusip,
                "ticker": ticker,
                "name": name,
                "value_thousands": value,
                "shares": shares,
            })

    return holdings


# ── Price Enrichment ──────────────────────────────────────────────────────────

def enrich_with_prices(holdings: list[dict]) -> list[dict]:
    """Add current price and sector to each holding. Keep SEC filing values intact."""
    tickers = [h["ticker"] for h in holdings if h["ticker"]]
    log(f"Fetching prices for {len(tickers)} tickers via yfinance...")

    closes = {}
    if tickers:
        try:
            data = yf.download(tickers, period="1d", progress=False, auto_adjust=True)
            if "Close" in data.columns:
                closes = data["Close"].iloc[-1].to_dict()
        except Exception as e:
            log(f"yfinance batch download failed: {e}. Falling back to individual.")

        for h in holdings:
            t = h.get("ticker", "")
            if not t:
                continue
            price = closes.get(t)
            if price is None:
                time.sleep(0.3)
                try:
                    info = yf.Ticker(t).fast_info
                    price = getattr(info, "last_price", None)
                except Exception:
                    price = None

            # Only store price for display — do NOT overwrite value_thousands from SEC filing
            if price:
                h["price"] = round(float(price), 2)
            else:
                # Derive estimated price from filing value
                if h["shares"] > 0 and h["value_thousands"] > 0:
                    h["price"] = round(h["value_thousands"] * 1000 / h["shares"], 2)
                else:
                    h["price"] = 0

            h["sector"] = SECTOR_MAP.get(t, "Other")

    # Calculate portfolio percentages based on SEC filing values
    total = sum(h.get("value_thousands", 0) for h in holdings)
    for h in holdings:
        h["portfolio_pct"] = round(h["value_thousands"] / total * 100, 2) if total else 0
        h.setdefault("price", 0)
        h.setdefault("sector", "Other")
        h.setdefault("prev_shares", 0)
        h.setdefault("prev_pct", 0)
        h.setdefault("change_type", "Hold")
        h.setdefault("share_change", 0)
        h.setdefault("share_change_pct", 0)

    holdings.sort(key=lambda x: x["value_thousands"], reverse=True)
    return holdings


# ── Compare with Previous Quarter ─────────────────────────────────────────────

def compute_changes(current: list[dict], previous: list[dict]) -> list[dict]:
    prev_map = {h["ticker"]: h for h in previous if h.get("ticker")}

    for h in current:
        t = h.get("ticker", "")
        prev = prev_map.get(t)
        if not prev:
            h["change_type"] = "New"
            h["prev_shares"] = 0
            h["prev_pct"] = 0
            h["share_change"] = h["shares"]
            h["share_change_pct"] = 100.0
        else:
            ps = prev["shares"]
            cs = h["shares"]
            h["prev_shares"] = ps
            h["prev_pct"] = prev.get("portfolio_pct", 0)
            h["share_change"] = cs - ps
            h["share_change_pct"] = round((cs - ps) / ps * 100, 2) if ps else 0
            if cs > ps:
                h["change_type"] = "Buy"
            elif cs < ps:
                h["change_type"] = "Reduced"
            else:
                h["change_type"] = "Hold"

    curr_tickers = {h.get("ticker") for h in current}
    exits = []
    for h in previous:
        t = h.get("ticker", "")
        if t and t not in curr_tickers:
            exit_h = dict(h)
            exit_h["change_type"] = "Sold"
            exit_h["shares"] = 0
            exit_h["value_thousands"] = 0
            exit_h["portfolio_pct"] = 0
            exit_h["share_change"] = -exit_h.get("prev_shares", exit_h.get("shares", 0))
            exits.append(exit_h)
    current.extend(exits)

    return current


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=== Buffett Tracker — Data Fetch Starting ===")

    previous_holdings = []
    if OUTPUT_PATH.exists():
        try:
            with open(OUTPUT_PATH) as f:
                prev_data = json.load(f)
                previous_holdings = prev_data.get("holdings", [])
            log(f"Loaded {len(previous_holdings)} holdings from previous run for diff")
        except Exception as e:
            log(f"Could not load previous data: {e}")

    try:
        acc_no, acc_fmt, filing_date, period = get_latest_13f_accession()
    except Exception as e:
        log(f"EDGAR fetch failed: {e}")
        sys.exit(1)

    try:
        xml_url = find_holdings_xml_url(BERKSHIRE_CIK, acc_no)
        log(f"Fetching holdings XML: {xml_url}")
        time.sleep(0.5)
        xml_resp = requests.get(xml_url, headers=HEADERS, timeout=60)
        xml_resp.raise_for_status()
        holdings = parse_13f_xml(xml_resp.text)
        log(f"Parsed {len(holdings)} holdings from XML")
        if len(holdings) == 0:
            raise RuntimeError("Parsed 0 holdings — wrong XML file")
    except Exception as e:
        log(f"Failed to fetch/parse holdings XML: {e}")
        log("Falling back to previous data...")
        if previous_holdings:
            holdings = previous_holdings
        else:
            log("No fallback data available. Exiting.")
            sys.exit(1)

    holdings = enrich_with_prices(holdings)
    holdings = compute_changes(holdings, previous_holdings)

    recent_trades = []
    for h in holdings:
        ct = h.get("change_type", "Hold")
        if ct in ("New", "Buy", "Reduced", "Sold") and h.get("share_change", 0) != 0:
            recent_trades.append({
                "quarter": f"Q{(int(period[5:7]) - 1) // 3 + 1} {period[:4]}",
                "ticker": h.get("ticker", ""),
                "name": h.get("name", ""),
                "type": ct,
                "shares": h.get("share_change", 0),
                "price": h.get("price", 0),
                "value_thousands": int(h.get("share_change", 0) * h.get("price", 0) / 1000),
                "portfolio_impact": round(h.get("portfolio_pct", 0) - h.get("prev_pct", 0), 2),
                "filing_date": filing_date,
                "transaction_date": period,
            })

    recent_trades.sort(key=lambda x: abs(x.get("value_thousands", 0)), reverse=True)
    total_value = sum(h.get("value_thousands", 0) for h in holdings)

    output = {
        "meta": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "filing_date": filing_date,
            "period_of_report": period,
            "quarter": f"Q{(int(period[5:7]) - 1) // 3 + 1} {period[:4]}",
            "total_value_thousands": total_value,
            "total_holdings": len([h for h in holdings if h.get("shares", 0) > 0]),
            "source": f"SEC EDGAR 13F-HR (CIK: {BERKSHIRE_CIK}, Accession: {acc_fmt})",
        },
        "holdings": holdings,
        "recent_trades": recent_trades,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    log(f"✓ Wrote {len(holdings)} holdings and {len(recent_trades)} trades → {OUTPUT_PATH}")
    log(f"  Total portfolio value: ${total_value / 1_000_000:.1f}B")
    log("=== Done ===")


if __name__ == "__main__":
    main()
