'use strict';

// ---------------------------------------------------------------------------
// State + data access
// ---------------------------------------------------------------------------

const state = {
  partners: [],   // [{id, name}]
  entries: [],    // [{id, partner_id, month, current_account, credit_card, cash_savings, investments, monthly_saved}]
  targets: [],    // [{year, net_worth_target, annual_savings_target, monthly_savings_target}]
  view: 'dashboard',
  targetYear: new Date().getFullYear(),
};

let charts = {}; // active Chart.js instances, destroyed on re-render

const api = {
  async load() {
    const r = await fetch('/api/data');
    if (r.status === 401) { window.location = '/login'; return; }
    if (!r.ok) throw new Error('Failed to load data');
    const d = await r.json();
    state.partners = d.partners;
    state.entries = d.entries;
    state.targets = d.targets || [];
  },
  async renamePartner(id, name) {
    const r = await fetch(`/api/partners/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error('Rename failed');
  },
  async saveEntry(entry) {
    const r = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
    return r.json();
  },
  async deleteEntry(id) {
    const r = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
  },
  async saveTargets(t) {
    const r = await fetch('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
    return r.json();
  },
};

// ---------------------------------------------------------------------------
// Formatting + finance helpers
// ---------------------------------------------------------------------------

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});
const gbp2 = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const money = (n) => gbp.format(Math.round(n || 0));
const signed = (n) => (n >= 0 ? '+' : '−') + gbp.format(Math.abs(Math.round(n || 0)));

const CATS = [
  { key: 'current_account', label: 'Current accounts', color: '#5b8cff', debt: false },
  { key: 'cash_savings',    label: 'Cash savings',     color: '#34d0a4', debt: false },
  { key: 'investments',     label: 'Investments',      color: '#a78bfa', debt: false },
  { key: 'credit_card',     label: 'Credit card debt', color: '#ff6b7d', debt: true  },
];

// net worth of a single entry row
const entryNet = (e) =>
  e.current_account + e.cash_savings + e.investments - e.credit_card;

const partnerName = (id) => (state.partners.find((p) => p.id === id) || {}).name || `Partner ${id}`;

// entries for one partner, oldest -> newest
const partnerEntries = (id) =>
  state.entries.filter((e) => e.partner_id === id).sort((a, b) => a.month.localeCompare(b.month));

// most recent entry for a partner (their "current" position)
const latestEntry = (id) => {
  const es = partnerEntries(id);
  return es.length ? es[es.length - 1] : null;
};

// sorted list of every month that has any data, across both partners
const allMonths = () =>
  [...new Set(state.entries.map((e) => e.month))].sort();

// combined net worth at a given month = sum of each partner's most recent entry
// at or before that month (so a partner who hasn't updated still counts).
function combinedNetAt(month) {
  let total = 0;
  for (const p of state.partners) {
    const es = partnerEntries(p.id).filter((e) => e.month <= month);
    if (es.length) total += entryNet(es[es.length - 1]);
  }
  return total;
}

function partnerNetAt(id, month) {
  const es = partnerEntries(id).filter((e) => e.month <= month);
  return es.length ? entryNet(es[es.length - 1]) : null;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prettyMonth(m) {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// combined net worth right now (latest recorded month), 0 if no data
function combinedNetNow() {
  const months = allMonths();
  return months.length ? combinedNetAt(months[months.length - 1]) : 0;
}

// targets row for a year, or null
const targetsFor = (year) => state.targets.find((t) => Number(t.year) === year) || null;

// total combined amount saved during a calendar year (sum of monthly_saved)
function savedInYear(year) {
  return state.entries
    .filter((e) => e.month.startsWith(String(year) + '-'))
    .reduce((sum, e) => sum + e.monthly_saved, 0);
}

// months from now (inclusive of the current month) through December of `year`.
// 0 if that December is already in the past.
function monthsRemainingInYear(year) {
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const endIdx = year * 12 + 11; // December of target year
  return Math.max(0, endIdx - nowIdx + 1);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const appEl = document.getElementById('app');

function destroyCharts() {
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};
}

function render() {
  destroyCharts();

  // sync tab highlight + labels
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === state.view);
  });
  const t1 = document.querySelector('.tab[data-view="p1"]');
  const t2 = document.querySelector('.tab[data-view="p2"]');
  if (t1) t1.textContent = partnerName(1);
  if (t2) t2.textContent = partnerName(2);

  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'p1') renderPartner(1);
  else if (state.view === 'p2') renderPartner(2);
  else if (state.view === 'targets') renderTargets();
}

// ---- Dashboard -------------------------------------------------------------

function renderDashboard() {
  const months = allMonths();
  const hasData = state.entries.length > 0;

  const combinedNow = hasData ? combinedNetAt(months[months.length - 1]) : 0;

  // combined category totals from each partner's latest entry
  const totals = { current_account: 0, cash_savings: 0, investments: 0, credit_card: 0, monthly_saved: 0 };
  for (const p of state.partners) {
    const e = latestEntry(p.id);
    if (e) {
      totals.current_account += e.current_account;
      totals.cash_savings += e.cash_savings;
      totals.investments += e.investments;
      totals.credit_card += e.credit_card;
      totals.monthly_saved += e.monthly_saved;
    }
  }
  const liquid = totals.current_account + totals.cash_savings;

  // month-over-month change in combined net worth
  let delta = null;
  if (months.length >= 2) {
    delta = combinedNetAt(months[months.length - 1]) - combinedNetAt(months[months.length - 2]);
  }

  // average monthly saved across the last up-to-6 recorded combined months
  const avgSaved = averageCombinedMonthlySaved();

  appEl.innerHTML = `
    <h1 class="view-title">Combined wealth</h1>
    <p class="view-sub">${partnerName(1)} &amp; ${partnerName(2)} · updated figures roll up here automatically.</p>

    <div class="hero">
      <div>
        <div class="label">Total net worth</div>
        <div class="value ${combinedNow >= 0 ? '' : 'neg'}">${money(combinedNow)}</div>
        ${delta !== null
          ? `<div class="delta ${delta >= 0 ? 'pos' : 'neg'}">${signed(delta)} vs last recorded month</div>`
          : `<div class="delta" style="color:var(--muted)">Add a second month to see your trend</div>`}
      </div>
      <div style="text-align:right">
        <div class="label">Saved together / month (avg)</div>
        <div class="value" style="font-size:30px" >${money(avgSaved)}</div>
      </div>
    </div>

    <div class="grid cols-4 section-gap">
      ${statCard('Liquid (cash + accounts)', money(liquid))}
      ${statCard('Investments', money(totals.investments))}
      ${statCard('Credit card debt', money(totals.credit_card), totals.credit_card > 0 ? 'neg' : '')}
      ${statCard('Saved this month', money(totals.monthly_saved))}
    </div>

    <div class="grid cols-2 section-gap">
      <div class="card">
        <h3>What makes up your wealth</h3>
        <div id="breakdown"></div>
      </div>
      <div class="card">
        <h3>Who holds what (net worth split)</h3>
        <div class="chart-wrap"><canvas id="splitChart"></canvas></div>
        <div class="split-legend" id="splitLegend"></div>
      </div>
    </div>

    <div class="card section-gap">
      <h3>Net worth trajectory &amp; projection</h3>
      ${months.length >= 1
        ? `<div class="chart-wrap"><canvas id="trendChart"></canvas></div>`
        : `<div class="empty">No data yet. Head to a partner tab and add your first month.</div>`}
    </div>

    ${dashboardGoalsCard()}

    <div class="card section-gap">
      <h3>Insights &amp; how to save more</h3>
      <div id="insights"></div>
    </div>
  `;

  renderBreakdown(totals);
  renderSplitChart();
  if (months.length >= 1) renderTrendChart(months, avgSaved);
  renderInsights(totals, avgSaved, combinedNow, delta);
}

function statCard(label, value, cls = '') {
  return `<div class="card stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}

function renderBreakdown(totals) {
  const el = document.getElementById('breakdown');
  const assets = totals.current_account + totals.cash_savings + totals.investments;
  const rows = CATS.map((c) => {
    const v = totals[c.key];
    return `<div class="breakdown-row">
      <span class="cat"><span class="dot" style="background:${c.color}"></span>${c.label}</span>
      <span class="${c.debt && v > 0 ? 'neg' : ''}">${c.debt && v > 0 ? '−' : ''}${money(v)}</span>
    </div>`;
  }).join('');
  el.innerHTML = rows + `
    <div class="breakdown-row" style="margin-top:6px;border-top:1px solid var(--border);font-weight:700">
      <span>Total assets</span><span>${money(assets)}</span>
    </div>`;
}

function renderSplitChart() {
  const data = state.partners.map((p) => {
    const e = latestEntry(p.id);
    return e ? Math.max(0, entryNet(e)) : 0;
  });
  const legend = document.getElementById('splitLegend');
  const colors = ['#5b8cff', '#f5a15b'];

  if (data.every((d) => d === 0)) {
    document.getElementById('splitChart').parentElement.innerHTML =
      '<div class="empty">Add figures on each partner tab to see the split.</div>';
    legend.innerHTML = '';
    return;
  }

  charts.split = new Chart(document.getElementById('splitChart'), {
    type: 'doughnut',
    data: {
      labels: state.partners.map((p) => p.name),
      datasets: [{ data, backgroundColor: colors, borderColor: '#1b2438', borderWidth: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } },
      },
    },
  });

  const total = data.reduce((a, b) => a + b, 0) || 1;
  legend.innerHTML = state.partners.map((p, i) =>
    `<span><span class="dot" style="background:${colors[i]}"></span>${p.name} — ${money(data[i])} (${Math.round(data[i] / total * 100)}%)</span>`
  ).join('');
}

function renderTrendChart(months, avgSaved) {
  // historical combined + per partner
  const combined = months.map((m) => combinedNetAt(m));
  const p1 = months.map((m) => partnerNetAt(1, m));
  const p2 = months.map((m) => partnerNetAt(2, m));

  // projection: 6 future months from the last combined value using avg monthly saved
  const labels = months.map(prettyMonth);
  const projLabels = [];
  const projData = new Array(months.length).fill(null);
  if (avgSaved !== 0 && months.length >= 1) {
    let last = combined[combined.length - 1];
    projData[projData.length - 1] = last; // connect the line
    const [ly, lm] = months[months.length - 1].split('-').map(Number);
    for (let i = 1; i <= 6; i++) {
      const d = new Date(ly, lm - 1 + i, 1);
      projLabels.push(d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }));
      last += avgSaved;
      projData.push(last);
    }
  }
  const allLabels = labels.concat(projLabels);
  // pad historical series with nulls for projection months
  const pad = (arr) => arr.concat(new Array(projLabels.length).fill(null));

  charts.trend = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Combined', data: pad(combined), borderColor: '#34d0a4', backgroundColor: 'rgba(52,208,164,.12)',
          borderWidth: 3, fill: true, tension: .3, pointRadius: 3,
        },
        {
          label: partnerName(1), data: pad(p1), borderColor: '#5b8cff', borderWidth: 2, tension: .3,
          pointRadius: 2, spanGaps: true,
        },
        {
          label: partnerName(2), data: pad(p2), borderColor: '#f5a15b', borderWidth: 2, tension: .3,
          pointRadius: 2, spanGaps: true,
        },
        {
          label: 'Projected', data: projData, borderColor: '#34d0a4', borderDash: [6, 5],
          borderWidth: 2, tension: .3, pointRadius: 0, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#97a3bd', usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (c) => c.parsed.y == null ? null : `${c.dataset.label}: ${money(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#97a3bd' } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#97a3bd', callback: (v) => money(v) } },
      },
    },
  });
}

// ---- Insights --------------------------------------------------------------

function averageCombinedMonthlySaved() {
  // sum both partners' monthly_saved per month, average over recorded months (last 6)
  const byMonth = {};
  for (const e of state.entries) {
    byMonth[e.month] = (byMonth[e.month] || 0) + e.monthly_saved;
  }
  const vals = Object.keys(byMonth).sort().slice(-6).map((m) => byMonth[m]);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function renderInsights(totals, avgSaved, combinedNow, delta) {
  const el = document.getElementById('insights');
  const items = [];

  // 1. Emergency fund coverage — assume ~£2,000/mo combined essential spend proxy is unknown,
  // so express liquid savings as months of buffer using their own saving as a rough scale.
  const liquid = totals.current_account + totals.cash_savings;
  if (liquid > 0) {
    items.push(insight('🛟', 'Emergency buffer',
      `You hold ${money(liquid)} in cash and current accounts. A common target is 3–6 months of expenses — keep this topped up before locking money into investments.`));
  }

  // 2. Credit card debt — the highest priority, since APR usually beats investment returns.
  if (totals.credit_card > 0) {
    const monthsToClear = avgSaved > 0 ? Math.ceil(totals.credit_card / avgSaved) : null;
    items.push(insight('🔴', 'Clear the credit card first',
      `You owe ${money(totals.credit_card)} on credit cards. At typical ~20%+ APR this costs more than most investments earn, so redirecting savings here usually beats investing. ${
        monthsToClear ? `At your current saving pace you could clear it in about ${monthsToClear} month${monthsToClear === 1 ? '' : 's'}.` : ''}`));
  }

  // 3. Savings rate / momentum
  if (avgSaved > 0) {
    items.push(insight('📈', 'Saving momentum',
      `Together you're putting away about ${money(avgSaved)} a month. That's ${money(avgSaved * 12)} a year — automating a standing order on payday is the easiest way to protect it.`));
  } else {
    items.push(insight('💡', 'Set a monthly savings target',
      `No monthly savings recorded yet. Add a "saved this month" figure on each partner tab — even a small automatic transfer compounds over time.`));
  }

  // 4. Investment vs cash balance
  const investable = totals.investments;
  if (liquid > 0 && investable >= 0) {
    const ratio = investable / (liquid + investable || 1);
    if (liquid > investable * 3 && liquid > 10000) {
      items.push(insight('🧺', 'A lot sitting in cash',
        `About ${Math.round((1 - ratio) * 100)}% of your assets are in cash. Once your emergency buffer is set, money beyond it may grow faster in tax-efficient investments (e.g. ISAs).`));
    }
  }

  // 5. Trajectory / projection to a milestone
  if (avgSaved > 0) {
    const target = nextMilestone(combinedNow);
    const monthsTo = Math.ceil((target - combinedNow) / avgSaved);
    if (monthsTo > 0 && monthsTo < 600) {
      items.push(insight('🎯', `On track for ${money(target)}`,
        `At ${money(avgSaved)}/month you'll reach a combined net worth of ${money(target)} in about ${monthsTo} months (${(monthsTo / 12).toFixed(1)} years) — before any investment growth.`));
    }
  }

  el.innerHTML = items.length ? items.join('') :
    `<div class="empty">Add your figures on each partner tab to unlock insights.</div>`;
}

function nextMilestone(n) {
  const steps = [10000, 25000, 50000, 100000, 150000, 200000, 250000, 500000, 750000, 1000000];
  return steps.find((s) => s > n) || (Math.ceil(n / 1000000 + 1) * 1000000);
}

function insight(ico, title, body) {
  return `<div class="insight"><div class="ico">${ico}</div><div class="body"><strong>${title}</strong><span>${body}</span></div></div>`;
}

// ---- Partner view ----------------------------------------------------------

function renderPartner(id) {
  const es = partnerEntries(id).slice().reverse(); // newest first for the table
  const latest = latestEntry(id);
  const net = latest ? entryNet(latest) : 0;

  appEl.innerHTML = `
    <div class="name-edit">
      <input id="pname" value="${escapeAttr(partnerName(id))}" aria-label="Your name" />
      <button class="btn-ghost btn-small" id="saveName">Save name</button>
    </div>
    <h1 class="view-title">${escapeHtml(partnerName(id))}'s finances</h1>
    <p class="view-sub">Update your figures each month. The dashboard combines them automatically.</p>

    <div class="grid cols-4">
      ${statCard('Your net worth', money(net), net >= 0 ? '' : 'neg')}
      ${statCard('Liquid', money(latest ? latest.current_account + latest.cash_savings : 0))}
      ${statCard('Investments', money(latest ? latest.investments : 0))}
      ${statCard('Card debt', money(latest ? latest.credit_card : 0), latest && latest.credit_card > 0 ? 'neg' : '')}
    </div>

    <div class="card section-gap">
      <h3>Add / update a month</h3>
      <form id="entryForm">
        <div class="form-grid">
          <div class="field">
            <label for="f_month">Month</label>
            <input type="month" id="f_month" required value="${currentMonthStr()}" />
          </div>
          <div class="field">
            <label for="f_current">Current account balance <span class="hint">£</span></label>
            <input type="number" step="0.01" id="f_current" placeholder="0" />
          </div>
          <div class="field">
            <label for="f_cash">Cash savings <span class="hint">£</span></label>
            <input type="number" step="0.01" id="f_cash" placeholder="0" />
          </div>
          <div class="field">
            <label for="f_invest">Investments <span class="hint">£ (stocks, pension, crypto…)</span></label>
            <input type="number" step="0.01" id="f_invest" placeholder="0" />
          </div>
          <div class="field">
            <label for="f_card">Credit card outstanding <span class="hint">£ owed</span></label>
            <input type="number" step="0.01" id="f_card" placeholder="0" />
          </div>
          <div class="field">
            <label for="f_saved">Saved this month <span class="hint">£ set aside</span></label>
            <input type="number" step="0.01" id="f_saved" placeholder="0" />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Save month</button>
          <span class="hint" style="color:var(--muted);font-size:13px">Saving an existing month overwrites it.</span>
        </div>
      </form>
    </div>

    <div class="card section-gap">
      <h3>Your history</h3>
      ${es.length ? historyTable(es) : '<div class="empty">No months recorded yet.</div>'}
    </div>
  `;

  // prefill form with latest figures for convenience
  if (latest) {
    setVal('f_current', latest.current_account);
    setVal('f_cash', latest.cash_savings);
    setVal('f_invest', latest.investments);
    setVal('f_card', latest.credit_card);
  }

  // clicking a history row loads it into the form
  document.querySelectorAll('#histBody tr').forEach((tr) => {
    tr.querySelector('.load-btn')?.addEventListener('click', () => {
      const e = state.entries.find((x) => x.id === Number(tr.dataset.id));
      if (!e) return;
      document.getElementById('f_month').value = e.month;
      setVal('f_current', e.current_account);
      setVal('f_cash', e.cash_savings);
      setVal('f_invest', e.investments);
      setVal('f_card', e.credit_card);
      setVal('f_saved', e.monthly_saved);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    tr.querySelector('.del-btn')?.addEventListener('click', async () => {
      if (!confirm('Delete this month?')) return;
      try {
        await api.deleteEntry(Number(tr.dataset.id));
        await api.load();
        render();
        toast('Month deleted', 'good');
      } catch (e) { toast(e.message, 'bad'); }
    });
  });

  document.getElementById('saveName').addEventListener('click', async () => {
    const name = document.getElementById('pname').value.trim();
    if (!name) return toast('Name cannot be empty', 'bad');
    try {
      await api.renamePartner(id, name);
      await api.load();
      render();
      toast('Name saved', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });

  document.getElementById('entryForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const entry = {
      partner_id: id,
      month: document.getElementById('f_month').value,
      current_account: getVal('f_current'),
      cash_savings: getVal('f_cash'),
      investments: getVal('f_invest'),
      credit_card: getVal('f_card'),
      monthly_saved: getVal('f_saved'),
    };
    if (!entry.month) return toast('Pick a month', 'bad');
    try {
      await api.saveEntry(entry);
      await api.load();
      render();
      toast('Saved ✓', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });
}

function historyTable(es) {
  const rows = es.map((e) => `
    <tr data-id="${e.id}">
      <td>${prettyMonth(e.month)}</td>
      <td>${money(e.current_account)}</td>
      <td>${money(e.cash_savings)}</td>
      <td>${money(e.investments)}</td>
      <td class="${e.credit_card > 0 ? 'neg' : ''}">${money(e.credit_card)}</td>
      <td>${money(e.monthly_saved)}</td>
      <td class="${entryNet(e) >= 0 ? '' : 'neg'}"><strong>${money(entryNet(e))}</strong></td>
      <td class="row-actions">
        <button class="btn-ghost btn-small load-btn">Edit</button>
        <button class="btn-danger btn-small del-btn">✕</button>
      </td>
    </tr>`).join('');
  return `<div style="overflow-x:auto"><table>
    <thead><tr>
      <th>Month</th><th>Current a/c</th><th>Cash</th><th>Investments</th>
      <th>Card debt</th><th>Saved</th><th>Net worth</th><th></th>
    </tr></thead>
    <tbody id="histBody">${rows}</tbody>
  </table></div>`;
}

// ---- Targets view ----------------------------------------------------------

// Compute every progress figure for a year's targets in one place.
function targetMetrics(year) {
  const t = targetsFor(year) || {
    net_worth_target: 0, annual_savings_target: 0, monthly_savings_target: 0,
  };
  const netNow = combinedNetNow();
  const saved = savedInYear(year);
  const monthsLeft = monthsRemainingInYear(year);
  const avgSaved = averageCombinedMonthlySaved();

  // net worth
  const nwGap = t.net_worth_target - netNow;
  const nwReqMonthly = t.net_worth_target > 0 ? (monthsLeft > 0 ? nwGap / monthsLeft : nwGap) : 0;
  const nwPct = t.net_worth_target > 0 ? clampPct(netNow / t.net_worth_target * 100) : 0;

  // annual savings
  const asRemaining = t.annual_savings_target - saved;
  const asReqMonthly = t.annual_savings_target > 0 ? (monthsLeft > 0 ? asRemaining / monthsLeft : asRemaining) : 0;
  const asPct = t.annual_savings_target > 0 ? clampPct(saved / t.annual_savings_target * 100) : 0;

  // monthly savings (measured against average monthly saving)
  const msPct = t.monthly_savings_target > 0 ? clampPct(avgSaved / t.monthly_savings_target * 100) : 0;

  return { t, netNow, saved, monthsLeft, avgSaved, nwGap, nwReqMonthly, nwPct, asRemaining, asReqMonthly, asPct, msPct };
}

function renderTargets() {
  const year = state.targetYear;
  const m = targetMetrics(year);
  const t = m.t;
  const hasAny = t.net_worth_target || t.annual_savings_target || t.monthly_savings_target;
  const isPast = m.monthsLeft === 0;

  appEl.innerHTML = `
    <div class="targets-head">
      <div>
        <h1 class="view-title">Goals &amp; targets</h1>
        <p class="view-sub">Set shared money goals for the year and track how you're doing against them.</p>
      </div>
      <div class="year-switch">
        <button class="btn-ghost btn-small" id="yearPrev" aria-label="Previous year">‹</button>
        <span class="year-label">${year}</span>
        <button class="btn-ghost btn-small" id="yearNext" aria-label="Next year">›</button>
      </div>
    </div>

    <div class="card">
      <h3>Set targets for ${year}</h3>
      <form id="targetForm">
        <div class="form-grid form-grid-3">
          <div class="field">
            <label for="t_networth">Net worth by end of ${year} <span class="hint">£ combined</span></label>
            <input type="number" step="100" id="t_networth" placeholder="0" value="${t.net_worth_target || ''}" />
          </div>
          <div class="field">
            <label for="t_annual">Total to save during ${year} <span class="hint">£ combined</span></label>
            <input type="number" step="100" id="t_annual" placeholder="0" value="${t.annual_savings_target || ''}" />
          </div>
          <div class="field">
            <label for="t_monthly">Monthly saving target <span class="hint">£ combined / month</span></label>
            <input type="number" step="50" id="t_monthly" placeholder="0" value="${t.monthly_savings_target || ''}" />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Save targets</button>
          <span class="hint" style="color:var(--muted);font-size:13px">Tip: monthly target × 12 is a good starting point for the annual goal.</span>
        </div>
      </form>
    </div>

    ${hasAny ? `
      <div class="grid cols-3 section-gap">
        ${nwCard(m, year, isPast)}
        ${asCard(m, year, isPast)}
        ${msCard(m, year)}
      </div>
      <div class="card section-gap">
        <h3>How to hit your ${year} goals</h3>
        <div id="targetInsights"></div>
      </div>
    ` : `<div class="card section-gap"><div class="empty">Set a target above to start tracking your progress.</div></div>`}
  `;

  const clampYear = (y) => Math.min(new Date().getFullYear() + 10, Math.max(new Date().getFullYear() - 5, y));
  document.getElementById('yearPrev').addEventListener('click', () => { state.targetYear = clampYear(year - 1); render(); });
  document.getElementById('yearNext').addEventListener('click', () => { state.targetYear = clampYear(year + 1); render(); });

  document.getElementById('targetForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api.saveTargets({
        year,
        net_worth_target: getVal('t_networth'),
        annual_savings_target: getVal('t_annual'),
        monthly_savings_target: getVal('t_monthly'),
      });
      await api.load();
      render();
      toast('Targets saved ✓', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });

  if (hasAny) renderTargetInsights(m, year);
}

function targetCard(title, big, sub, pct, ok, status) {
  return `<div class="card target-card">
    <h3>${title}</h3>
    <div class="target-num">${big} <span class="target-sub">${sub}</span></div>
    ${progressBar(pct, ok)}
    <div class="target-status ${ok ? 'pos' : 'warnc'}">${Math.round(pct)}% · ${status}</div>
  </div>`;
}

function placeholderCard(title, msg) {
  return `<div class="card target-card"><h3>${title}</h3><div class="empty" style="padding:22px 0">${msg}</div></div>`;
}

function nwCard(m, year, isPast) {
  const t = m.t;
  if (!t.net_worth_target) return placeholderCard('Net worth goal', `No net-worth target set for ${year}.`);
  const done = m.nwGap <= 0;
  const ok = done || m.avgSaved >= m.nwReqMonthly;
  const status = done
    ? `reached ${money(m.netNow)}`
    : isPast
      ? `year ended ${money(Math.abs(m.nwGap))} short`
      : `${money(m.nwGap)} to go · need ~${money(m.nwReqMonthly)}/mo`;
  return targetCard(`Net worth by Dec ${year}`, money(m.netNow), 'of ' + money(t.net_worth_target), m.nwPct, ok, status);
}

function asCard(m, year, isPast) {
  const t = m.t;
  if (!t.annual_savings_target) return placeholderCard('Annual savings goal', `No annual savings target set for ${year}.`);
  const done = m.asRemaining <= 0;
  const ok = done || m.avgSaved >= m.asReqMonthly;
  const status = done
    ? `goal hit 🎉`
    : isPast
      ? `year ended ${money(Math.abs(m.asRemaining))} short`
      : `${money(m.asRemaining)} left · need ~${money(m.asReqMonthly)}/mo`;
  return targetCard(`Saved in ${year}`, money(m.saved), 'of ' + money(t.annual_savings_target), m.asPct, ok, status);
}

function msCard(m, year) {
  const t = m.t;
  if (!t.monthly_savings_target) return placeholderCard('Monthly savings goal', 'No monthly target set.');
  const ok = m.avgSaved >= t.monthly_savings_target;
  const status = ok ? `beating target by ${money(m.avgSaved - t.monthly_savings_target)}/mo`
                    : `${money(t.monthly_savings_target - m.avgSaved)}/mo short`;
  return targetCard('Monthly saving (avg)', money(m.avgSaved), 'of ' + money(t.monthly_savings_target) + '/mo', m.msPct, ok, status);
}

function renderTargetInsights(m, year) {
  const el = document.getElementById('targetInsights');
  if (!el) return;
  const t = m.t;
  const isPast = m.monthsLeft === 0;
  const items = [];

  if (t.net_worth_target) {
    if (m.nwGap <= 0) {
      items.push(insight('🎯', 'Net-worth goal reached',
        `You're at ${money(m.netNow)}, already past your ${money(t.net_worth_target)} target for ${year}. Time to set a bolder one.`));
    } else if (isPast) {
      items.push(insight('📅', 'Net-worth window closed',
        `${year} has ended — you finished ${money(m.nwGap)} short of ${money(t.net_worth_target)}. Roll the gap into next year's goal.`));
    } else if (m.avgSaved >= m.nwReqMonthly) {
      items.push(insight('✅', 'On track for your net-worth goal',
        `You need about ${money(m.nwReqMonthly)}/month over the ${m.monthsLeft} months left, and you're saving ${money(m.avgSaved)}. Any investment growth is a bonus on top.`));
    } else {
      items.push(insight('⚠️', 'Behind on net-worth goal',
        `Reaching ${money(t.net_worth_target)} needs ~${money(m.nwReqMonthly)}/month for ${m.monthsLeft} months, but you're saving ${money(m.avgSaved)} — a ${money(m.nwReqMonthly - m.avgSaved)}/month gap. Investment growth can close part of it; the rest means saving more or extending the deadline.`));
    }
  }

  if (t.annual_savings_target) {
    if (m.asRemaining <= 0) {
      items.push(insight('🏆', 'Annual savings goal hit',
        `You've put away ${money(m.saved)} this year — goal smashed. Consider redirecting new savings toward investments or clearing debt.`));
    } else if (isPast) {
      items.push(insight('📅', 'Savings year closed',
        `You saved ${money(m.saved)} of the ${money(t.annual_savings_target)} target. Carry the shortfall into next year's plan.`));
    } else {
      const ok = m.avgSaved >= m.asReqMonthly;
      items.push(insight(ok ? '✅' : '⚠️', ok ? 'Savings pace looks good' : 'Pick up the savings pace',
        `You've banked ${money(m.saved)} of ${money(t.annual_savings_target)}. To finish you need ${money(m.asReqMonthly)}/month for the ${m.monthsLeft} months left${ok ? " — you're ahead of that." : `, versus ${money(m.avgSaved)}/mo now.`}`));
    }
  }

  if (t.monthly_savings_target) {
    const diff = m.avgSaved - t.monthly_savings_target;
    if (diff >= 0) {
      items.push(insight('💪', 'Beating your monthly target',
        `Your average ${money(m.avgSaved)}/month is ${money(diff)} above target. Funnel the extra at your credit card first, then investments.`));
    } else {
      items.push(insight('🔧', 'Closing the monthly gap',
        `You're ${money(-diff)}/month below your ${money(t.monthly_savings_target)} target. Easy wins: a payday standing order, trimming one recurring subscription, or sending any windfall straight to savings.`));
    }
  }

  // Sanity-check: does the monthly target actually support the net-worth goal?
  if (t.monthly_savings_target && t.net_worth_target && !isPast && m.nwReqMonthly > t.monthly_savings_target * 1.05) {
    items.push(insight('🧮', 'Your goals don’t quite line up',
      `Your net-worth goal implies ~${money(m.nwReqMonthly)}/month, but your monthly target is only ${money(t.monthly_savings_target)}. Raise the monthly target or give the net-worth goal more time.`));
  }

  el.innerHTML = items.length ? items.join('') : `<div class="empty">Set some targets to see tailored guidance.</div>`;
}

// Compact goals strip shown on the dashboard (current year only).
function dashboardGoalsCard() {
  const year = new Date().getFullYear();
  const t = targetsFor(year);
  if (!t || !(t.net_worth_target || t.annual_savings_target || t.monthly_savings_target)) return '';
  const m = targetMetrics(year);
  const rows = [];
  if (t.net_worth_target)
    rows.push(miniGoal(`Net worth ${year}`, m.netNow, t.net_worth_target, m.nwPct, m.nwGap <= 0 || m.avgSaved >= m.nwReqMonthly));
  if (t.annual_savings_target)
    rows.push(miniGoal(`Saved in ${year}`, m.saved, t.annual_savings_target, m.asPct, m.asRemaining <= 0 || m.avgSaved >= m.asReqMonthly));
  if (t.monthly_savings_target)
    rows.push(miniGoal('Monthly saving', m.avgSaved, t.monthly_savings_target, m.msPct, m.avgSaved >= t.monthly_savings_target));
  return `<div class="card section-gap">
    <h3>Goals progress · ${year}</h3>
    ${rows.join('')}
    <div style="margin-top:10px"><a class="goals-link" href="#targets">Manage targets →</a></div>
  </div>`;
}

function miniGoal(label, current, target, pct, ok) {
  return `<div class="mini-goal">
    <div class="mini-goal-top"><span>${label}</span><span class="${ok ? 'pos' : 'warnc'}">${money(current)} / ${money(target)}</span></div>
    ${progressBar(pct, ok)}
  </div>`;
}

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

const clampPct = (v) => Math.max(0, Math.min(100, v));
const progressBar = (pct, ok) =>
  `<div class="pbar"><div class="pbar-fill ${ok ? 'ok' : 'behind'}" style="width:${Math.max(2, clampPct(pct))}%"></div></div>`;
const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
const getVal = (id) => { const el = document.getElementById(id); return el ? Number(el.value || 0) : 0; };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = escapeHtml;

let toastTimer;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  state.view = btn.dataset.view;
  location.hash = btn.dataset.view;
  render();
});

window.addEventListener('hashchange', () => {
  const v = location.hash.replace('#', '');
  if (['dashboard', 'p1', 'p2', 'targets'].includes(v) && v !== state.view) {
    state.view = v;
    render();
  }
});

(async function init() {
  try {
    await api.load();
    const v = location.hash.replace('#', '');
    if (['dashboard', 'p1', 'p2', 'targets'].includes(v)) state.view = v;
    render();
  } catch (e) {
    appEl.innerHTML = `<div class="empty">Couldn't load data: ${escapeHtml(e.message)}</div>`;
  }
})();
