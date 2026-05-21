# Buffett Tracker 📊

A free, publicly accessible dashboard tracking Warren Buffett's Berkshire Hathaway portfolio in real time, sourced from SEC EDGAR 13F-HR filings.

**Live data · No backend · No paid APIs · Fully automated**

---

## 🚀 Quick Start (5 minutes)

### 1. Fork or Clone this repo
```bash
git clone https://github.com/YOUR_USERNAME/buffett-tracker.git
cd buffett-tracker
```

### 2. Run the data fetch script locally (first time)
```bash
pip install -r scripts/requirements.txt
python scripts/fetch_data.py
```
This populates `data/portfolio.json` with the latest 13F data.

### 3. Open `index.html` in your browser
You'll see the full dashboard immediately. No server needed.

### 4. Deploy to GitHub Pages or Vercel (see below)

---

## 🌐 Deploying to GitHub Pages (free)

1. Push your repo to GitHub.
2. Go to **Settings → Pages**.
3. Set Source to **Deploy from branch**, Branch: `main`, Folder: `/ (root)`.
4. Your site is live at `https://YOUR_USERNAME.github.io/buffett-tracker/`.

That's it. Every time GitHub Actions updates `data/portfolio.json` and pushes it, GitHub Pages automatically redeploys.

## 🌐 Deploying to Vercel (free, slightly faster)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project**, select your `buffett-tracker` repo.
3. Framework Preset: **Other** (it's plain HTML).
4. Click **Deploy**. Done.

Vercel gives you a URL like `https://buffett-tracker.vercel.app`.

> **Tip:** Vercel deployments auto-trigger on every push — so when GitHub Actions commits updated data, Vercel redeploys automatically too.

---

## ⚙️ GitHub Actions — Automated Daily Data Refresh

The workflow at `.github/workflows/update-data.yml` runs every day at 6 AM UTC. It:

1. Runs `python scripts/fetch_data.py`
2. Fetches the latest 13F filing from SEC EDGAR
3. Enriches it with current prices via yfinance
4. Commits the updated `data/portfolio.json` if anything changed

**To enable it:**
- Push your repo to GitHub (the workflow file is already included).
- No secrets needed — it uses the default `GITHUB_TOKEN`.
- To trigger manually: go to **Actions → Update Portfolio Data → Run workflow**.

**Optional:** Set a `CONTACT_EMAIL` variable in **Settings → Variables → Actions** to personalize the SEC EDGAR User-Agent header (recommended by SEC).

---

## 📁 File Structure

```
buffett-tracker/
├── index.html                    # Dashboard UI
├── css/
│   └── styles.css                # All styles (dark/light theme)
├── js/
│   └── app.js                    # All dashboard logic
├── data/
│   └── portfolio.json            # Auto-generated — do not edit manually
├── scripts/
│   ├── fetch_data.py             # Data pipeline (SEC EDGAR + yfinance)
│   └── requirements.txt          # Python deps
└── .github/
    └── workflows/
        └── update-data.yml       # GitHub Actions cron job
```

---

## 🔧 Extending CUSIP → Ticker Mappings

SEC 13F filings use CUSIP codes, not ticker symbols. The script has a built-in mapping table (`CUSIP_TO_TICKER` in `fetch_data.py`) covering Berkshire's known holdings.

If you see holdings with blank tickers, find the CUSIP via [CUSIP Lookup](https://www.cusip.com/) or [OpenFIGI](https://www.openfigi.com/api) (free API) and add them to the dict.

---

## ⚖️ Legal & Terms of Service Notes

| Source | Status |
|--------|--------|
| **SEC EDGAR** | ✅ Fully public, no restrictions on programmatic access. Always set a descriptive `User-Agent` header per [SEC guidelines](https://www.sec.gov/os/accessing-edgar-data). |
| **yfinance** | ⚠️ Uses Yahoo Finance data. Yahoo's ToS prohibits commercial use. This project is for personal/educational use only. Don't sell access. |
| **Dataroma / WisdomWhale** | ℹ️ These sites aggregate 13F data. We don't scrape them — we go direct to SEC EDGAR. |
| **CNBC / hedgefollow** | ℹ️ Not used as data sources in this project. |

**SEC rate limits:** EDGAR asks for max 10 requests/second. The script has `time.sleep()` calls to stay well within this.

---

## 💡 Future Enhancements

- **Email alerts** — Use [Resend](https://resend.com) (free tier) or a GitHub Actions → email step to notify when a new 13F drops
- **Price alerts** — Compare current prices to Buffett's estimated entry prices
- **Multi-investor comparison** — Add other major 13F filers (Ackman, Tepper, Einhorn) using the same EDGAR pipeline
- **Portfolio history charts** — Store past JSON snapshots in `data/history/YYYY-QQ.json` and plot value over time
- **News integration** — Add a news feed panel using free RSS from Yahoo Finance or Google News
- **Mobile app** — Wrap in Capacitor for an iOS/Android app
- **13F amendment alerts** — Berkshire sometimes files 13F-HR/A amendments; add amendment detection

---

## 📬 Data Sources

- **Primary:** [SEC EDGAR](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001067294&type=13F-HR) — authoritative public filings
- **Prices:** [Yahoo Finance via yfinance](https://pypi.org/project/yfinance/)
- **CIK:** `0001067294` (Berkshire Hathaway Inc)

---

*Not financial advice. Data lags SEC filing schedule (quarterly). Always verify against original filings.*
