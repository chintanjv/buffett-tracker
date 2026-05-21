/* ═══════════════════════════════════════════════════════════════════════════
   BUFFETT TRACKER — app.js
   Loads data/portfolio.json, drives all dashboard interactivity
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  data: null,          // full portfolio.json contents
  filtered: {
    holdings: [],
    trades: [],
  },
  filters: {
    search: '',
    quarter: 'all',
    types: new Set(['Buy','New','Reduced','Sold','Hold']),
    sectors: new Set(),
    tiers: new Set(['Mega','Major','Mid','Minor']),
  },
  sort: { col: 'value_thousands', dir: 'desc' },
  page: 1,
  rowsPerPage: 10,
  charts: {},
  pieMode: 'stock',    // 'stock' | 'sector'
};

// ── Formatting helpers ────────────────────────────────────────────────────
const fmt = {
  billions: n => {
    const v = Math.abs(n / 1_000_000);
    return v >= 1
      ? `$${v.toFixed(1)}B`
      : `$${(n / 1000).toFixed(0)}M`;
  },
  millions: n => `$${(n / 1000).toFixed(0)}M`,
  shares: n => {
    const a = Math.abs(n);
    if (a >= 1_000_000_000) return `${(n/1e9).toFixed(2)}B`;
    if (a >= 1_000_000)     return `${(n/1e6).toFixed(1)}M`;
    if (a >= 1_000)         return `${(n/1e3).toFixed(0)}K`;
    return n.toLocaleString();
  },
  pct: n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%',
  date: s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—',
};

// ── Conviction tier helper ────────────────────────────────────────────────
function getTier(pct) {
  if (pct >= 10)  return 'Mega';
  if (pct >= 5)   return 'Major';
  if (pct >= 1)   return 'Mid';
  return 'Minor';
}

const SECTOR_COLORS = {
  'Technology':             '#3b82f6',
  'Financials':             '#d4af37',
  'Consumer Staples':       '#22c55e',
  'Energy':                 '#f97316',
  'Healthcare':             '#a78bfa',
  'Communication Services': '#38bdf8',
  'Consumer Discretionary': '#fb7185',
  'Materials':              '#86efac',
  'Industrials':            '#fbbf24',
  'Utilities':              '#6b7280',
  'Real Estate':            '#f472b6',
  'Other':                  '#9ca3af',
};

function stockColor(idx) {
  const palette = ['#d4af37','#22c55e','#3b82f6','#f97316','#a78bfa','#38bdf8','#fb7185','#86efac','#fbbf24','#f472b6','#6ee7b7','#fca5a5','#93c5fd','#d8b4fe','#fed7aa'];
  return palette[idx % palette.length];
}

// ── Load Data ─────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const resp = await fetch('data/portfolio.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.data = await resp.json();
    init();
  } catch (err) {
    console.error('Failed to load portfolio data:', err);
    document.getElementById('lastUpdated').textContent = 'Error loading data — check console';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
function init() {
  const { meta, holdings, recent_trades } = state.data;

  // Populate sector filter
  const sectors = [...new Set(holdings.map(h => h.sector).filter(Boolean))].sort();
  sectors.forEach(s => state.filters.sectors.add(s));
  const sectorSel = document.getElementById('sectorFilter');
  sectorSel.innerHTML = '';
  sectors.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s; opt.selected = true;
    sectorSel.appendChild(opt);
  });

  // Populate quarter filter
  const quarters = [...new Set(recent_trades.map(t => t.quarter))].sort().reverse();
  const qSel = document.getElementById('quarterFilter');
  quarters.forEach(q => {
    const opt = document.createElement('option');
    opt.value = q; opt.textContent = q;
    qSel.appendChild(opt);
  });

  // Update last-updated
  const updated = new Date(meta.last_updated);
  document.getElementById('lastUpdated').textContent =
    `Updated ${updated.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} via SEC EDGAR`;

  // Theme from localStorage
  const savedTheme = localStorage.getItem('buffettTheme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  // Restore grid layout from localStorage (GridStack does this)
  initGrid();
  attachEventListeners();
  applyFilters();
}

// ── GridStack ──────────────────────────────────────────────────────────────
function initGrid() {
  const savedLayout = localStorage.getItem('buffettGridLayout');

  const grid = GridStack.init({
    column: 12,
    cellHeight: 60,
    margin: 6,
    resizable: { handles: 'se' },
    draggable: { handle: '.card-header' },
  }, '#mainGrid');

  // Save layout on change
  grid.on('change', () => {
    const layout = grid.save();
    localStorage.setItem('buffettGridLayout', JSON.stringify(layout));
  });

  // Restore saved layout
  if (savedLayout) {
    try { grid.load(JSON.parse(savedLayout)); } catch (e) { /* ignore */ }
  }

  state.grid = grid;
}

// ── Event Listeners ───────────────────────────────────────────────────────
function attachEventListeners() {
  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('buffettTheme', next);
    document.getElementById('themeToggle').textContent = next === 'dark' ? '☀' : '☾';
    rebuildCharts();
  });

  // Search
  let searchDebounce;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.search = e.target.value.toLowerCase().trim();
      state.page = 1;
      applyFilters();
    }, 200);
  });

  // Quarter filter
  document.getElementById('quarterFilter').addEventListener('change', e => {
    state.filters.quarter = e.target.value;
    state.page = 1;
    applyFilters();
  });

  // Type chips
  document.getElementById('typeFilter').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const val = chip.dataset.val;
    if (state.filters.types.has(val)) state.filters.types.delete(val);
    else state.filters.types.add(val);
    chip.classList.toggle('active');
    state.page = 1;
    applyFilters();
  });

  // Sector filter (multi-select)
  document.getElementById('sectorFilter').addEventListener('change', e => {
    const selected = [...e.target.selectedOptions].map(o => o.value);
    state.filters.sectors = new Set(selected);
    state.page = 1;
    applyFilters();
  });

  // Tier chips
  document.getElementById('tierFilter').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const val = chip.dataset.val;
    if (state.filters.tiers.has(val)) state.filters.tiers.delete(val);
    else state.filters.tiers.add(val);
    chip.classList.toggle('active');
    state.page = 1;
    applyFilters();
  });

  // Reset
  document.getElementById('resetFilters').addEventListener('click', resetFilters);

  // Rows per page
  document.getElementById('rowsPerPage').addEventListener('change', e => {
    state.rowsPerPage = parseInt(e.target.value, 10);
    state.page = 1;
    renderTradesTable();
  });

  // Pie chart mode toggles
  document.getElementById('chartByStock').addEventListener('click', () => {
    state.pieMode = 'stock';
    document.getElementById('chartByStock').classList.add('active');
    document.getElementById('chartBySector').classList.remove('active');
    rebuildPieChart();
  });
  document.getElementById('chartBySector').addEventListener('click', () => {
    state.pieMode = 'sector';
    document.getElementById('chartBySector').classList.add('active');
    document.getElementById('chartByStock').classList.remove('active');
    rebuildPieChart();
  });

  // Chart download buttons
  document.getElementById('downloadPie').addEventListener('click', () => downloadChart('portfolioPieChart', 'berkshire-portfolio-distribution'));
  document.getElementById('downloadSector').addEventListener('click', () => downloadChart('sectorBarChart', 'berkshire-sector-allocation'));

  // Export CSV
  document.getElementById('exportCsv').addEventListener('click', exportCsv);

  // Card collapse toggles
  document.querySelectorAll('.card-collapse').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.card').querySelector('.card-body');
      body.classList.toggle('collapsed');
      btn.classList.toggle('collapsed');
    });
  });

  // Row detail close
  document.getElementById('closeDetail').addEventListener('click', () => {
    document.getElementById('rowDetail').style.display = 'none';
  });
  document.getElementById('rowDetail').addEventListener('click', e => {
    if (e.target === document.getElementById('rowDetail'))
      document.getElementById('rowDetail').style.display = 'none';
  });

  // Stat card clicks
  document.querySelectorAll('.stat-card[data-action]').forEach(card => {
    card.addEventListener('click', () => handleStatCardClick(card.dataset.action));
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') resetFilters();
    if (e.key === 'd' || e.key === 'D') document.getElementById('themeToggle').click();
    if (e.key === 'f' || e.key === 'F') document.getElementById('searchInput').focus();
    if (e.key === 'Escape') document.getElementById('rowDetail').style.display = 'none';
  });
}

// ── Filter Logic ──────────────────────────────────────────────────────────
function applyFilters() {
  const { data, filters } = state;
  if (!data) return;

  const q = filters.search;

  // Filter holdings (for pie, top10, tiers)
  state.filtered.holdings = data.holdings.filter(h => {
    if (!state.filters.sectors.has(h.sector)) return false;
    const tier = getTier(h.portfolio_pct);
    if (!state.filters.tiers.has(tier)) return false;
    if (q && !h.ticker?.toLowerCase().includes(q) && !h.name?.toLowerCase().includes(q)) return false;
    return h.shares > 0;
  });

  // Filter trades
  state.filtered.trades = data.recent_trades.filter(t => {
    if (filters.quarter !== 'all' && t.quarter !== filters.quarter) return false;
    if (!filters.types.has(t.type)) return false;
    const holdingForSector = data.holdings.find(h => h.ticker === t.ticker);
    if (holdingForSector && !filters.sectors.has(holdingForSector.sector)) return false;
    if (q && !t.ticker?.toLowerCase().includes(q) && !t.name?.toLowerCase().includes(q)) return false;
    return true;
  });

  renderAll();
}

function resetFilters() {
  state.filters.search = '';
  state.filters.quarter = 'all';
  state.filters.types = new Set(['Buy','New','Reduced','Sold','Hold']);
  state.filters.tiers = new Set(['Mega','Major','Mid','Minor']);
  // Re-select all sectors
  const sectors = [...new Set(state.data.holdings.map(h => h.sector).filter(Boolean))];
  state.filters.sectors = new Set(sectors);
  state.page = 1;

  // Reset UI
  document.getElementById('searchInput').value = '';
  document.getElementById('quarterFilter').value = 'all';
  document.querySelectorAll('#typeFilter .chip, #tierFilter .chip').forEach(c => c.classList.add('active'));
  const sectorSel = document.getElementById('sectorFilter');
  [...sectorSel.options].forEach(o => o.selected = true);

  applyFilters();
}

function handleStatCardClick(action) {
  if (action === 'filter-buys') {
    state.filters.types = new Set(['Buy','New']);
    document.querySelectorAll('#typeFilter .chip').forEach(c => {
      c.classList.toggle('active', state.filters.types.has(c.dataset.val));
    });
    state.page = 1;
    applyFilters();
  } else if (action === 'filter-sells') {
    state.filters.types = new Set(['Reduced','Sold']);
    document.querySelectorAll('#typeFilter .chip').forEach(c => {
      c.classList.toggle('active', state.filters.types.has(c.dataset.val));
    });
    state.page = 1;
    applyFilters();
  } else {
    resetFilters();
  }
}

// ── Render All ────────────────────────────────────────────────────────────
function renderAll() {
  renderStatCards();
  renderBanner();
  renderTop10();
  renderTiers();
  renderTradesTable();
  rebuildCharts();
}

// ── Stat Cards ────────────────────────────────────────────────────────────
function renderStatCards() {
  const { meta, recent_trades } = state.data;
  document.getElementById('statTotalValue').textContent = fmt.billions(meta.total_value_thousands);
  document.getElementById('statQuarter').textContent = meta.quarter;
  document.getElementById('statHoldings').textContent = meta.total_holdings;

  const buys = recent_trades.filter(t => t.type === 'Buy' || t.type === 'New').sort((a,b) => b.value_thousands - a.value_thousands);
  const sells = recent_trades.filter(t => t.type === 'Reduced' || t.type === 'Sold').sort((a,b) => a.value_thousands - b.value_thousands);

  if (buys[0]) {
    document.getElementById('statBigBuy').textContent = buys[0].ticker;
    document.getElementById('statBigBuySub').textContent = fmt.billions(Math.abs(buys[0].value_thousands));
  }
  if (sells[0]) {
    document.getElementById('statBigSell').textContent = sells[0].ticker;
    document.getElementById('statBigSellSub').textContent = fmt.billions(Math.abs(sells[0].value_thousands));
  }
}

// ── Banner ────────────────────────────────────────────────────────────────
function renderBanner() {
  const { meta, recent_trades } = state.data;
  const current_quarter_trades = recent_trades.filter(t => t.quarter === meta.quarter && t.type !== 'Hold');

  const container = document.getElementById('bannerTrades');
  if (!current_quarter_trades.length) {
    document.getElementById('newQuarterBanner').style.display = 'none';
    return;
  }
  container.innerHTML = current_quarter_trades.map(t => `
    <span class="trade-badge ${t.type}">
      ${t.type === 'New' ? '★ NEW ' : ''}${t.ticker} — ${t.type}
    </span>
  `).join('');
}

// ── Top 10 ────────────────────────────────────────────────────────────────
function renderTop10() {
  const top10 = [...state.filtered.holdings]
    .sort((a,b) => b.value_thousands - a.value_thousands)
    .slice(0, 10);

  const container = document.getElementById('top10List');
  if (!top10.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem;">No holdings match filters.</p>'; return; }

  container.innerHTML = top10.map((h,i) => `
    <div class="holding-row" data-ticker="${h.ticker}">
      <span class="holding-rank">${i+1}</span>
      <span class="holding-ticker">${h.ticker}</span>
      <span class="holding-name">${h.name}</span>
      <span class="holding-value">${fmt.billions(h.value_thousands)}</span>
      <span class="holding-pct">${h.portfolio_pct.toFixed(1)}%</span>
    </div>
  `).join('');

  container.querySelectorAll('.holding-row').forEach(row => {
    row.addEventListener('click', () => {
      state.filters.search = row.dataset.ticker.toLowerCase();
      document.getElementById('searchInput').value = row.dataset.ticker;
      state.page = 1;
      applyFilters();
    });
  });
}

// ── Conviction Tiers ──────────────────────────────────────────────────────
function renderTiers() {
  const tiers = { Mega: [], Major: [], Mid: [], Minor: [] };
  state.filtered.holdings.forEach(h => tiers[getTier(h.portfolio_pct)]?.push(h));

  const container = document.getElementById('tiersList');
  container.innerHTML = Object.entries(tiers).map(([tier, stocks]) => `
    <div class="tier-group">
      <div class="tier-label">
        <span class="tier-dot ${tier.toLowerCase()}"></span>
        ${tier} ${tier === 'Mega' ? '>10%' : tier === 'Major' ? '5–10%' : tier === 'Mid' ? '1–5%' : '<1%'}
        <span style="color:var(--text-muted);margin-left:auto">${stocks.length}</span>
      </div>
      <div class="tier-stocks">
        ${stocks.map(h => `<span class="tier-tag" data-ticker="${h.ticker}" title="${h.name} — ${h.portfolio_pct.toFixed(2)}%">${h.ticker}</span>`).join('')}
        ${!stocks.length ? '<span style="color:var(--text-muted);font-size:.72rem;">—</span>' : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.tier-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      state.filters.search = tag.dataset.ticker.toLowerCase();
      document.getElementById('searchInput').value = tag.dataset.ticker;
      state.page = 1;
      applyFilters();
    });
  });
}

// ── Trades Table ──────────────────────────────────────────────────────────
function renderTradesTable() {
  const { filtered, sort, page, rowsPerPage } = state;
  const trades = [...filtered.trades];

  // Sort
  trades.sort((a,b) => {
    let av = a[sort.col] ?? '', bv = b[sort.col] ?? '';
    if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination
  const total = trades.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const start = (page - 1) * rowsPerPage;
  const paginated = trades.slice(start, start + rowsPerPage);

  // Empty state
  document.getElementById('emptyState').style.display = total ? 'none' : 'block';
  document.querySelector('.table-wrap table').style.display = total ? '' : 'none';

  // Rows
  const tbody = document.getElementById('tradesBody');
  tbody.innerHTML = paginated.map(t => {
    const impact = t.portfolio_impact ?? 0;
    return `
    <tr data-trade='${JSON.stringify(t).replace(/'/g, "&#39;")}'>
      <td class="td-ticker">${t.ticker}</td>
      <td>${t.name}</td>
      <td><span class="type-pill ${t.type}">${t.type}</span></td>
      <td class="td-num">${fmt.shares(t.shares)}</td>
      <td class="td-num">${fmt.billions(Math.abs(t.value_thousands))}</td>
      <td class="td-impact ${impact >= 0 ? 'pos' : 'neg'}">${fmt.pct(impact)}</td>
      <td class="td-num">${fmt.date(t.filing_date)}</td>
      <td class="td-num">${t.quarter}</td>
    </tr>`;
  }).join('');

  // Sort indicators
  document.querySelectorAll('#tradesTable th').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === sort.col) th.classList.add(sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  // Row click → detail panel
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      const trade = JSON.parse(row.dataset.trade);
      showRowDetail(trade);
    });
  });

  // Pagination
  renderPagination(totalPages, total, start + 1, Math.min(start + rowsPerPage, total));
}

function renderPagination(totalPages, total, from, to) {
  const container = document.getElementById('pagination');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = `<span class="page-info">${from}–${to} of ${total}</span>`;
  html += `<button class="page-btn" id="pagePrev" ${state.page === 1 ? 'disabled' : ''}>‹</button>`;

  const range = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= state.page - 2 && i <= state.page + 2)) range.push(i);
    else if (range[range.length-1] !== '…') range.push('…');
  }
  range.forEach(p => {
    if (p === '…') html += `<span class="page-info">…</span>`;
    else html += `<button class="page-btn ${p === state.page ? 'active':''}" data-page="${p}">${p}</button>`;
  });

  html += `<button class="page-btn" id="pageNext" ${state.page === totalPages ? 'disabled' : ''}>›</button>`;
  container.innerHTML = html;

  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { state.page = parseInt(btn.dataset.page,10); renderTradesTable(); });
  });
  container.querySelector('#pagePrev')?.addEventListener('click', () => { if (state.page > 1) { state.page--; renderTradesTable(); } });
  container.querySelector('#pageNext')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; renderTradesTable(); } });
}

// Sortable column headers
document.querySelectorAll('#tradesTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sort.col === col) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort.col = col; state.sort.dir = 'desc'; }
    renderTradesTable();
  });
});

// ── Row Detail Panel ──────────────────────────────────────────────────────
function showRowDetail(trade) {
  const holding = state.data.holdings.find(h => h.ticker === trade.ticker) || {};
  const panel = document.getElementById('rowDetailContent');
  panel.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:1.4rem;margin-bottom:16px">
      ${trade.ticker} — ${trade.name}
      <span class="type-pill ${trade.type}" style="vertical-align:middle;margin-left:8px">${trade.type}</span>
    </h3>
    <div class="detail-grid">
      <div class="detail-item"><label>Sector</label><span>${holding.sector || '—'}</span></div>
      <div class="detail-item"><label>Quarter</label><span>${trade.quarter}</span></div>
      <div class="detail-item"><label>Filing Date</label><span>${fmt.date(trade.filing_date)}</span></div>
      <div class="detail-item"><label>Period End</label><span>${fmt.date(trade.transaction_date)}</span></div>
      <div class="detail-item"><label>Shares Changed</label><span>${fmt.shares(trade.shares)}</span></div>
      <div class="detail-item"><label>Est. Price/Share</label><span>$${(trade.price || 0).toFixed(2)}</span></div>
      <div class="detail-item"><label>Est. Total Value</label><span>${fmt.billions(Math.abs(trade.value_thousands))}</span></div>
      <div class="detail-item"><label>Portfolio Impact</label><span style="color:${(trade.portfolio_impact||0) >= 0 ? 'var(--color-buy)':'var(--color-sold)'}">${fmt.pct(trade.portfolio_impact||0)}</span></div>
      <div class="detail-item"><label>Shares Now Held</label><span>${fmt.shares(holding.shares || 0)}</span></div>
      <div class="detail-item"><label>Current Port. %</label><span>${(holding.portfolio_pct||0).toFixed(2)}%</span></div>
      <div class="detail-item"><label>Conviction Tier</label><span>${getTier(holding.portfolio_pct||0)}</span></div>
      <div class="detail-item"><label>Current Value</label><span>${fmt.billions(holding.value_thousands || 0)}</span></div>
    </div>
  `;
  document.getElementById('rowDetail').style.display = 'flex';
}

// ── Charts ────────────────────────────────────────────────────────────────
function chartThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue('--text-secondary').trim(),
    muted: style.getPropertyValue('--text-muted').trim(),
    border: style.getPropertyValue('--border').trim(),
    bg: style.getPropertyValue('--bg-card').trim(),
  };
}

function rebuildCharts() {
  rebuildPieChart();
  rebuildSectorChart();
}

function rebuildPieChart() {
  const { filtered, pieMode } = state;
  const c = chartThemeColors();

  // Destroy old chart
  if (state.charts.pie) { state.charts.pie.destroy(); }

  let labels, values, colors;

  if (pieMode === 'stock') {
    const top = [...filtered.holdings]
      .sort((a,b) => b.value_thousands - a.value_thousands)
      .slice(0, 15);
    const otherVal = filtered.holdings
      .sort((a,b) => b.value_thousands - a.value_thousands)
      .slice(15)
      .reduce((s,h) => s + h.value_thousands, 0);

    labels = top.map(h => h.ticker);
    values = top.map(h => h.value_thousands);
    colors = top.map((_,i) => stockColor(i));
    if (otherVal > 0) { labels.push('Other'); values.push(otherVal); colors.push('#555'); }
  } else {
    const sectorMap = {};
    filtered.holdings.forEach(h => {
      sectorMap[h.sector] = (sectorMap[h.sector] || 0) + h.value_thousands;
    });
    const sorted = Object.entries(sectorMap).sort((a,b) => b[1]-a[1]);
    labels = sorted.map(([s]) => s);
    values = sorted.map(([,v]) => v);
    colors = labels.map(s => SECTOR_COLORS[s] || '#888');
  }

  const total = values.reduce((s,v) => s + v, 0);

  state.charts.pie = new Chart(document.getElementById('portfolioPieChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: 'transparent',
        borderWidth: 0,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      animation: { animateRotate: true, duration: 600 },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: c.text,
            font: { family: 'DM Mono, monospace', size: 10 },
            boxWidth: 10,
            padding: 8,
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = (ctx.raw / total * 100).toFixed(1);
              return ` ${fmt.billions(ctx.raw)} — ${pct}%`;
            }
          }
        }
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        const label = labels[elements[0].index];
        if (pieMode === 'stock') {
          state.filters.search = label.toLowerCase();
          document.getElementById('searchInput').value = label;
          state.page = 1;
          applyFilters();
        } else {
          // filter by sector
          state.filters.sectors = new Set([label]);
          const sectorSel = document.getElementById('sectorFilter');
          [...sectorSel.options].forEach(o => o.selected = o.value === label);
          state.page = 1;
          applyFilters();
        }
      }
    }
  });
}

function rebuildSectorChart() {
  const c = chartThemeColors();
  if (state.charts.sector) { state.charts.sector.destroy(); }

  const sectorMap = {};
  state.filtered.holdings.forEach(h => {
    sectorMap[h.sector] = (sectorMap[h.sector] || 0) + h.portfolio_pct;
  });
  const sorted = Object.entries(sectorMap).sort((a,b) => b[1]-a[1]);

  state.charts.sector = new Chart(document.getElementById('sectorBarChart'), {
    type: 'bar',
    data: {
      labels: sorted.map(([s]) => s),
      datasets: [{
        data: sorted.map(([,v]) => v),
        backgroundColor: sorted.map(([s]) => SECTOR_COLORS[s] || '#888'),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}% of portfolio` }
        }
      },
      scales: {
        x: {
          ticks: { color: c.muted, font: { family: 'DM Mono, monospace', size: 10 }, callback: v => v + '%' },
          grid: { color: c.border },
          border: { display: false },
        },
        y: {
          ticks: { color: c.text, font: { family: 'DM Mono, monospace', size: 10 } },
          grid: { display: false },
          border: { display: false },
        }
      }
    }
  });
}

// ── Chart Download ─────────────────────────────────────────────────────────
function downloadChart(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  const link = document.createElement('a');
  link.download = filename + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Export CSV ────────────────────────────────────────────────────────────
function exportCsv() {
  const headers = ['Ticker','Company','Type','Shares Changed','Est. Value ($K)','Portfolio Impact','Filing Date','Quarter'];
  const rows = state.filtered.trades.map(t => [
    t.ticker, `"${t.name}"`, t.type, t.shares,
    Math.abs(t.value_thousands), t.portfolio_impact,
    t.filing_date, t.quarter
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'berkshire-trades.csv';
  link.click();
}

// ── Boot ──────────────────────────────────────────────────────────────────
loadData();
