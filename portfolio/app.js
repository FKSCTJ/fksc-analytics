/* Portfolio — holdings from several brokers, live prices (Finnhub for US stocks, Coinbase for crypto), FX from Coinbase. */
(function () {
  'use strict';
  const C = window.PortfolioCSV;
  const KEY = 'portfolio.v1';
  const BROKERS = ['CMC', 'IBKR', 'Coinbase', 'Other'];
  const TYPES = { stock: 'Stocks', etf: 'ETFs', crypto: 'Crypto', cash: 'Cash', other: 'Other' };
  const TYPE_ORDER = ['stock', 'etf', 'crypto', 'other', 'cash'];
  const CURS = ['AUD', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'NZD', 'SGD', 'HKD'];
  const STABLE = { USDC: 1, USDT: 1, DAI: 1, PYUSD: 1, BUSD: 1 };
  const $ = id => document.getElementById(id);

  // ---------- state ----------
  function seed() {
    const at = '2026-10-15T15:24:00Z';
    const h = (code, sym, units, avg, price, chg) => ({ id: uid(), broker: 'CMC', code, symbol: sym, exchange: 'US', type: 'stock',
      units, avgCost: avg, costCurrency: 'AUD', quoteCurrency: 'USD', manualPrice: price, name: '', _q: { price, chg } });
    const list = [h('DUOL:US', 'DUOL', 59, 342.356, 145.76, 6.03), h('RIOT:US', 'RIOT', 362, 44.069, 14.445, -0.655),
      h('UNH:US', 'UNH', 10, 491.116, 410.66, 14.87), h('ASPN:US', 'ASPN', 774, 12.35, 5.19, 0.035)];
    const quotes = {};
    list.forEach(x => { quotes['fh:' + x.symbol] = { price: x._q.price, chg: x._q.chg, cur: 'USD', at }; delete x._q; });
    return { v: 1, holdings: list, cash: [{ broker: 'CMC', amount: 0.70, currency: 'AUD' }],
      fx: { USD: 1, AUD: 1.4352 }, fxAt: null, quotes,
      settings: { display: 'AUD', donut: 'type', filter: 'All', finnhubKey: '' } };
  }
  function load() {
    try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && Array.isArray(j.holdings)) return normalize(j); } catch (e) { /* ignore */ }
    return seed();
  }
  function normalize(j) {
    const s = seed();
    return { v: 1, holdings: j.holdings || [], cash: j.cash || [], fx: { ...s.fx, ...(j.fx || {}) }, fxAt: j.fxAt || null,
      quotes: j.quotes || {}, settings: { ...s.settings, ...(j.settings || {}) } };
  }
  let S = load();
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { notice('This browser is not saving data (private window or storage blocked). Export a backup before closing.'); } };
    if (now) run(); else saveTimer = setTimeout(run, 1500);
  }
  window.addEventListener('pagehide', () => save(true));
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------- formatting ----------
  const nfCache = {};
  const nf = (min, max) => nfCache[min + '-' + max] || (nfCache[min + '-' + max] = new Intl.NumberFormat('en-AU', { minimumFractionDigits: min, maximumFractionDigits: max }));
  const fmt = (v, d = 2) => Number.isFinite(v) ? nf(d, d).format(v) : '—';
  const fmtU = v => Number.isFinite(v) ? nf(0, Math.abs(v) < 1 ? 8 : Math.abs(v) < 100 && v % 1 ? 4 : 0).format(v) : '—';
  const fmtP = v => !Number.isFinite(v) ? '—' : nf(v < 1 ? 4 : v < 10 ? 4 : 3, v < 1 ? 6 : v < 10 ? 4 : 3).format(v);
  const sg = (v, d = 2) => !Number.isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '-' : '') + nf(d, d).format(Math.abs(v));
  const pc = v => !Number.isFinite(v) ? '—' : sg(v * 100, 2) + '%';
  const money = (v, cur, d = 2) => {
    if (!Number.isFinite(v)) return '—';
    const s = new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v));
    return (v < 0 ? '-' : '') + s;
  };
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => C.num(s);

  // ---------- money ----------
  function conv(v, from, to) {
    if (!Number.isFinite(v)) return NaN;
    if (from === to) return v;
    const a = S.fx[from], b = S.fx[to];
    return a && b ? v / a * b : NaN;
  }
  const live = new Set();         // quote keys updated live this session
  function qkey(h) {
    if (h.type === 'crypto') return 'cb:' + h.symbol;
    if ((h.type === 'stock' || h.type === 'etf' || h.type === 'other') && h.exchange === 'US') return 'fh:' + h.symbol;
    return null;
  }
  function quoteOf(h) {
    if (h.type === 'crypto' && STABLE[h.symbol]) return { price: 1, chg: 0, cur: 'USD', src: 'live' };
    const k = qkey(h); const q = k && S.quotes[k];
    if (q && Number.isFinite(q.price)) return { price: q.price, chg: Number.isFinite(q.chg) ? q.chg : 0, cur: q.cur || h.quoteCurrency, src: live.has(k) ? 'live' : 'stored', at: q.at };
    if (Number.isFinite(h.manualPrice)) return { price: h.manualPrice, chg: 0, cur: h.quoteCurrency, src: 'manual' };
    return { price: NaN, chg: 0, cur: h.quoteCurrency, src: 'none' };
  }

  function compute() {
    const D = S.settings.display, f = S.settings.filter;
    const inF = b => f === 'All' || b === f;
    const rows = S.holdings.filter(h => inF(h.broker)).map(h => {
      const q = quoteOf(h);
      const value = conv(h.units * q.price, q.cur, D);
      const cost = conv(h.units * h.avgCost, h.costCurrency, D);
      const day = conv(h.units * q.chg, q.cur, D);
      const pl = value - cost, prev = q.price - q.chg;
      return { h, q, value, cost, day, pl, plPct: cost ? pl / cost : NaN, chgPct: prev ? q.chg / prev : NaN };
    });
    const t = { value: 0, cost: 0, day: 0, cash: 0, missing: 0 };
    rows.forEach(r => {
      if (Number.isFinite(r.value)) t.value += r.value; else t.missing++;
      if (Number.isFinite(r.cost)) t.cost += r.cost;
      if (Number.isFinite(r.day)) t.day += r.day;
    });
    S.cash.filter(c => inF(c.broker)).forEach(c => { const v = conv(c.amount, c.currency, D); if (Number.isFinite(v)) t.cash += v; });
    t.pl = rows.reduce((a, r) => a + (Number.isFinite(r.value) && Number.isFinite(r.cost) ? r.pl : 0), 0);
    const costKnown = rows.reduce((a, r) => a + (Number.isFinite(r.value) && Number.isFinite(r.cost) ? r.cost : 0), 0);
    t.plPct = costKnown ? t.pl / costKnown : NaN;
    rows.forEach(r => { r.w = t.value && Number.isFinite(r.value) ? r.value / t.value : 0; });
    rows.sort((a, b) => (b.value || 0) - (a.value || 0));
    return { rows, t, D };
  }

  // ---------- rendering ----------
  let renderQueued = false, lastRender = 0;
  const lastPrice = {};
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    const wait = Math.max(0, 900 - (performance.now() - lastRender));
    setTimeout(() => requestAnimationFrame(() => { renderQueued = false; lastRender = performance.now(); draw(); }), wait);
  }
  function draw() {
    const { rows, t, D } = compute();
    // band
    $('k-hold').textContent = money(t.value, D);
    $('k-cash').textContent = money(t.cash, D);
    $('k-total').textContent = money(t.value + t.cash, D);
    $('k-pl').innerHTML = `<span class="${cls(t.pl)}">${money(t.pl, D)}</span><span class="pill ${cls(t.pl)}">${pc(t.plPct)}</span>`;
    $('k-day').innerHTML = `<span class="${cls(t.day)}">${money(t.day, D)}</span>`;
    document.querySelectorAll('#cur-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === D)));
    document.querySelectorAll('#donut-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.donut === S.settings.donut)));
    document.querySelectorAll('.dc').forEach(e => { e.textContent = '(' + D + ')'; });
    const fxPairs = ['USD', 'AUD', 'EUR'].filter(c => c !== D && S.fx[c]).map(c => `${c}/${D} ${fmt(conv(1, c, D), 4)}`);
    $('fx-meta').textContent = fxPairs.join(' · ') + (S.fxAt ? ' · rates ' + new Date(S.fxAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : ' · rates from your CMC screenshot');

    drawChips();
    drawBrokers(D);
    drawDonut(rows, t, D);

    // table
    const changed = {};
    rows.forEach(r => { const k = r.h.id; const p = r.q.price; if (lastPrice[k] != null && p !== lastPrice[k]) changed[k] = p > lastPrice[k] ? 'flash-up' : 'flash-down'; lastPrice[k] = p; });
    const dot = src => `<span class="dot ${src === 'live' ? 'live-dot' : src === 'stored' ? 'stored-dot' : 'manual-dot'}" title="${src === 'live' ? 'Live price' : src === 'stored' ? 'Last known price' : src === 'manual' ? 'Manual price' : 'No price'}"></span>`;
    const badge = h => `<span class="badge ${h.type}">${esc((h.symbol || h.code || '?').slice(0, 1))}</span>`;
    $('rows').innerHTML = rows.map(r => {
      const h = r.h, q = r.q;
      return `<tr>
        <td><span class="code">${badge(h)}<span title="${esc(h.name)}">${esc(h.code)}</span></span></td>
        <td class="acct">${esc(h.broker)}</td>
        <td class="${changed[h.id] || ''}">${dot(q.src)}<span class="cur">${esc(q.cur)}</span><b>${fmtP(q.price)}</b></td>
        <td class="${cls(q.chg)}">${sg(q.chg, q.price < 10 ? 4 : 3)}</td>
        <td class="${cls(q.chg)}">${pc(r.chgPct)}</td>
        <td>${fmtU(h.units)}</td>
        <td>${fmtP(h.avgCost)}<span class="unit">${esc(h.costCurrency)}</span></td>
        <td>${fmt(r.cost)}</td>
        <td>${fmt(r.value)}<span class="unit">${D}</span></td>
        <td class="${cls(r.day)}">${sg(r.day)}</td>
        <td class="${cls(r.pl)}">${sg(r.pl)}</td>
        <td class="${cls(r.pl)}">${pc(r.plPct)}</td>
        <td><span class="wbar">${fmt(r.w * 100, 1)}%<i><b style="width:${Math.min(100, r.w * 100)}%"></b></i></span></td>
        <td><button class="icon" data-edit="${esc(h.id)}" aria-label="Edit ${esc(h.code)}">✎</button></td>
      </tr>`;
    }).join('');
    $('foot').innerHTML = rows.length ? `<tr><td>Total</td><td></td><td></td><td></td><td></td><td></td><td></td>
      <td>${fmt(t.cost)}</td><td>${fmt(t.value)} ${D}</td><td class="${cls(t.day)}">${sg(t.day)}</td>
      <td class="${cls(t.pl)}">${sg(t.pl)}</td><td class="${cls(t.pl)}">(${pc(t.plPct)})</td><td>100%</td><td></td></tr>` : '';
    $('cards').innerHTML = rows.map(r => {
      const h = r.h, q = r.q;
      return `<div class="card">
        <div><div class="code">${badge(h)}${esc(h.code)}</div>
          <div class="sub">${esc(h.broker)} · ${fmtU(h.units)} @ ${dot(q.src)}<span class="cur">${esc(q.cur)}</span>${fmtP(q.price)} <span class="${cls(q.chg)}">${pc(r.chgPct)}</span></div></div>
        <div class="r"><div class="big">${fmt(r.value)}</div><div class="sub ${cls(r.pl)}">${sg(r.pl)} (${pc(r.plPct)})</div></div>
        <div class="grid">
          <div><span>Avg price</span><span>${fmtP(h.avgCost)} ${esc(h.costCurrency)}</span></div>
          <div><span>Day</span><span class="${cls(r.day)}">${sg(r.day)}</span></div>
          <div><span>Weight</span><span>${fmt(r.w * 100, 1)}%</span></div>
        </div>
        <div class="acts"><button class="icon" data-edit="${esc(h.id)}">✎ Edit</button></div>
      </div>`;
    }).join('') + (rows.length ? `<div class="cardtotal"><span>Total</span><span>${money(t.value, D)}</span></div>` : '');
    $('empty').hidden = rows.length > 0;
  }

  function brokersInUse() {
    const set = new Set([...S.holdings.map(h => h.broker), ...S.cash.filter(c => c.amount).map(c => c.broker)]);
    return BROKERS.filter(b => set.has(b));
  }
  function drawChips() {
    const list = ['All', ...brokersInUse()];
    if (!list.includes(S.settings.filter)) S.settings.filter = 'All';
    $('chips').innerHTML = list.map(b => `<button data-filter="${b}" aria-pressed="${b === S.settings.filter}">${b === 'All' ? 'All accounts' : b}</button>`).join('');
  }
  function drawBrokers(D) {
    const per = BROKERS.map(b => {
      let v = 0, cost = 0, vk = 0;
      S.holdings.filter(h => h.broker === b).forEach(h => {
        const q = quoteOf(h); const x = conv(h.units * q.price, q.cur, D); const c = conv(h.units * h.avgCost, h.costCurrency, D);
        if (Number.isFinite(x)) { v += x; if (Number.isFinite(c)) { cost += c; vk += x; } }
      });
      const cashRow = S.cash.find(c => c.broker === b);
      const cash = cashRow ? conv(cashRow.amount, cashRow.currency, D) : 0;
      const n = S.holdings.filter(h => h.broker === b).length;
      return { b, v, cost, vk, cash: Number.isFinite(cash) ? cash : 0, cashRow, n };
    });
    const total = per.reduce((a, p) => a + p.v + p.cash, 0);
    $('brokers').innerHTML = per.map(p => {
      const tot = p.v + p.cash, pl = p.vk - p.cost;
      return `<li>
        <span class="bn">${p.b}</span><span class="bv">${money(tot, D)}</span>
        <span class="bs">${p.n ? p.n + ' position' + (p.n > 1 ? 's' : '') : 'No positions'}${p.n ? ` · <span class="${cls(pl)}">${money(pl, D)}</span>` : ''}
          · cash ${p.cashRow ? money(p.cashRow.amount, p.cashRow.currency) : '—'} <button class="link" data-cash="${p.b}">Edit cash</button></span>
        <span class="bs">${total ? fmt(tot / total * 100, 1) + '%' : ''}</span>
        <span class="bar"><b style="width:${total ? Math.max(0, tot / total * 100) : 0}%"></b></span>
      </li>`;
    }).join('');
  }

  function drawDonut(rows, t, D) {
    let parts;
    if (S.settings.donut === 'type') {
      const by = {};
      rows.forEach(r => { if (Number.isFinite(r.value)) by[r.h.type] = (by[r.h.type] || 0) + r.value; });
      if (t.cash > 0) by.cash = (by.cash || 0) + t.cash;
      parts = TYPE_ORDER.filter(k => by[k] > 0).map(k => ({ label: TYPES[k], v: by[k] }));
    } else {
      const items = rows.filter(r => r.value > 0).map(r => ({ label: r.h.code.replace(/:US$/, ''), v: r.value }));
      parts = items.slice(0, 8);
      const rest = items.slice(8).reduce((a, x) => a + x.v, 0);
      if (rest > 0) parts.push({ label: 'Other', v: rest });
      if (t.cash > 0) parts.push({ label: 'Cash', v: t.cash });
    }
    const total = parts.reduce((a, p) => a + p.v, 0);
    const R = 84, CIRC = 2 * Math.PI * R; let off = 0;
    const col = i => `var(--c${(i % 9) + 1})`;
    const segs = total ? parts.map((p, i) => {
      const len = p.v / total * CIRC; const gap = parts.length > 1 ? Math.min(2, len / 3) : 0;
      const s = `<circle cx="110" cy="110" r="${R}" fill="none" stroke="${col(i)}" stroke-width="26" stroke-dasharray="${Math.max(0, len - gap)} ${CIRC}" stroke-dashoffset="${-off}" transform="rotate(-90 110 110)"><title>${esc(p.label)}: ${money(p.v, D)}</title></circle>`;
      off += len; return s;
    }).join('') : `<circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--line)" stroke-width="26"/>`;
    $('donut').innerHTML = segs +
      `<text x="110" y="104" text-anchor="middle" font-size="12" class="sub">Total</text>` +
      `<text x="110" y="126" text-anchor="middle" font-size="18" font-weight="700">${esc(money(total, D, 0))}</text>`;
    $('legend').innerHTML = parts.map((p, i) => `<li><span class="sw" style="background:${col(i)}"></span><span>${esc(p.label)}</span><span class="amt">${money(p.v, D, 0)}</span><span class="pct">${fmt(p.v / total * 100, 1)}%</span></li>`).join('')
      || '<li><span></span><span class="amt">Nothing to show yet</span></li>';
  }

  // ---------- notices ----------
  const notes = new Map();
  function notice(msg, key, action) {
    key = key || msg;
    if (msg) notes.set(key, { msg, action }); else notes.delete(key);
    const el = $('notice'); const list = [...notes.values()];
    el.hidden = !list.length;
    el.innerHTML = list.map(n => esc(n.msg) + (n.action ? ` <button data-act="${n.action}">${n.action === 'settings' ? 'Open settings' : 'Fix'}</button>` : '')).join('<br>');
  }

  // ---------- live status ----------
  const feed = { fh: 'off', cb: 'off' };
  function needs() {
    return { fh: S.holdings.some(h => qkey(h)?.startsWith('fh:')), cb: S.holdings.some(h => h.type === 'crypto' && !STABLE[h.symbol]) };
  }
  function drawLive() {
    const n = needs(); const parts = [];
    if (n.fh) parts.push(feed.fh); if (n.cb) parts.push(feed.cb);
    const el = $('live'); const on = parts.filter(x => x === 'on').length;
    el.className = 'live' + (parts.length && on === parts.length ? ' on' : on ? ' part' : '');
    el.querySelector('span').textContent = !parts.length ? 'No live feeds needed' : on === parts.length ? 'Live' : on ? 'Partly live' :
      (n.fh && !S.settings.finnhubKey ? 'Stocks need a key' : 'Connecting…');
  }

  // ---------- FX (Coinbase, no key) ----------
  async function refreshFx() {
    try {
      const r = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(); const rates = j && j.data && j.data.rates;
      if (!rates) throw new Error('no rates');
      CURS.forEach(c => { const v = Number(rates[c]); if (v > 0) S.fx[c] = v; });
      S.fx.USD = 1; S.fxAt = new Date().toISOString(); save(); render();
      notice(null, 'fx');
    } catch (e) { notice('Exchange rates could not be refreshed; using the last known rates.', 'fx'); }
  }

  // ---------- Finnhub (US stocks) ----------
  let fhWs = null, fhTries = 0, fhSubs = new Set(), fhPollTimer = null;
  const fhSymbols = () => [...new Set(S.holdings.map(qkey).filter(k => k && k.startsWith('fh:')).map(k => k.slice(3)))];
  async function pollFinnhub() {
    clearTimeout(fhPollTimer);
    const key = S.settings.finnhubKey; const syms = fhSymbols();
    if (!syms.length) { feed.fh = 'off'; drawLive(); return; }
    if (!key) { notice('Add your free Finnhub key to get live stock prices. Until then, the last known prices are shown.', 'fhkey', 'settings'); feed.fh = 'off'; drawLive(); return; }
    notice(null, 'fhkey');
    for (const s of syms) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`);
        if (r.status === 401 || r.status === 403) { notice('Finnhub rejected the API key, or this symbol needs a paid plan. Check the key in Settings.', 'fhbad', 'settings'); break; }
        if (r.status === 429) break;
        const j = await r.json();
        if (j && j.c > 0) {
          const k = 'fh:' + s; const prev = S.quotes[k] || {};
          const pcl = j.pc > 0 ? j.pc : prev.prevClose;
          S.quotes[k] = { price: j.c, chg: pcl ? j.c - pcl : j.d, prevClose: pcl, cur: 'USD', at: new Date().toISOString() };
          live.add(k); notice(null, 'fhbad');
        }
      } catch (e) { /* network hiccup: keep last known */ }
      await new Promise(r => setTimeout(r, 300));
    }
    save(); render(); connectFinnhubWs();
    fhPollTimer = setTimeout(pollFinnhub, 60000);
  }
  function connectFinnhubWs() {
    const key = S.settings.finnhubKey; const syms = fhSymbols();
    if (!key || !syms.length) return;
    if (fhWs && (fhWs.readyState === 0 || fhWs.readyState === 1)) { syncFinnhubSubs(); return; }
    try { fhWs = new WebSocket('wss://ws.finnhub.io?token=' + encodeURIComponent(key)); } catch (e) { return; }
    fhSubs = new Set();
    fhWs.onopen = () => { fhTries = 0; feed.fh = 'on'; drawLive(); syncFinnhubSubs(); };
    fhWs.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type !== 'trade' || !Array.isArray(m.data)) return;
      const latest = {};
      m.data.forEach(d => { if (!latest[d.s] || d.t >= latest[d.s].t) latest[d.s] = d; });
      Object.values(latest).forEach(d => {
        const k = 'fh:' + d.s; const q = S.quotes[k] || {};
        S.quotes[k] = { ...q, price: d.p, chg: q.prevClose ? d.p - q.prevClose : q.chg, cur: 'USD', at: new Date(d.t).toISOString() };
        live.add(k);
      });
      save(); render();
    };
    fhWs.onclose = () => { feed.fh = 'off'; drawLive(); fhTries++; setTimeout(connectFinnhubWs, Math.min(60000, 3000 * fhTries)); };
    fhWs.onerror = () => { try { fhWs.close(); } catch (e) { /* */ } };
  }
  function syncFinnhubSubs() {
    if (!fhWs || fhWs.readyState !== 1) return;
    const want = new Set(fhSymbols());
    want.forEach(s => { if (!fhSubs.has(s)) { fhWs.send(JSON.stringify({ type: 'subscribe', symbol: s })); fhSubs.add(s); } });
    fhSubs.forEach(s => { if (!want.has(s)) { fhWs.send(JSON.stringify({ type: 'unsubscribe', symbol: s })); fhSubs.delete(s); } });
  }

  // ---------- Coinbase (crypto, no key) ----------
  let cbWs = null, cbTries = 0, cbSubs = new Set();
  const cbUnsupported = new Set();
  const cbSymbols = () => [...new Set(S.holdings.filter(h => h.type === 'crypto' && !STABLE[h.symbol]).map(h => h.symbol))].filter(s => !cbUnsupported.has(s));
  async function seedCoinbase() {
    for (const s of cbSymbols()) {
      try {
        const r = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(s)}-USD/stats`);
        if (r.status === 404 || r.status === 400) { cbUnsupported.add(s); continue; }
        const j = await r.json(); const last = Number(j.last), open = Number(j.open);
        if (last > 0) { S.quotes['cb:' + s] = { price: last, chg: open > 0 ? last - open : 0, open, cur: 'USD', at: new Date().toISOString() }; live.add('cb:' + s); }
      } catch (e) { /* keep last known */ }
    }
    save(); render(); connectCoinbaseWs();
  }
  function connectCoinbaseWs() {
    const syms = cbSymbols();
    if (!syms.length) { feed.cb = 'off'; drawLive(); return; }
    if (cbWs && (cbWs.readyState === 0 || cbWs.readyState === 1)) { syncCoinbaseSubs(); return; }
    try { cbWs = new WebSocket('wss://ws-feed.exchange.coinbase.com'); } catch (e) { return; }
    cbSubs = new Set();
    cbWs.onopen = () => { cbTries = 0; feed.cb = 'on'; drawLive(); syncCoinbaseSubs(); };
    cbWs.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type !== 'ticker' || !m.product_id) return;
      const s = m.product_id.replace(/-USD$/, ''); const p = Number(m.price), o = Number(m.open_24h);
      if (!(p > 0)) return;
      S.quotes['cb:' + s] = { price: p, chg: o > 0 ? p - o : 0, open: o, cur: 'USD', at: new Date().toISOString() };
      live.add('cb:' + s); save(); render();
    };
    cbWs.onclose = () => { feed.cb = 'off'; drawLive(); cbTries++; setTimeout(connectCoinbaseWs, Math.min(60000, 3000 * cbTries)); };
    cbWs.onerror = () => { try { cbWs.close(); } catch (e) { /* */ } };
  }
  function syncCoinbaseSubs() {
    if (!cbWs || cbWs.readyState !== 1) return;
    const want = new Set(cbSymbols()); const add = [...want].filter(s => !cbSubs.has(s)); const rem = [...cbSubs].filter(s => !want.has(s));
    if (add.length) cbWs.send(JSON.stringify({ type: 'subscribe', product_ids: add.map(s => s + '-USD'), channels: ['ticker'] }));
    if (rem.length) cbWs.send(JSON.stringify({ type: 'unsubscribe', product_ids: rem.map(s => s + '-USD'), channels: ['ticker'] }));
    add.forEach(s => cbSubs.add(s)); rem.forEach(s => cbSubs.delete(s));
  }
  function refreshFeeds() { pollFinnhub(); seedCoinbase(); drawLive(); }

  // ---------- modals ----------
  function open(id) {
    ['m-pos', 'm-import', 'm-cash', 'm-settings'].forEach(m => { $(m).hidden = m !== id; });
    $('ov').hidden = false; document.body.style.overflow = 'hidden';
    const f = $(id).querySelector('input:not([type=file]),select'); if (f) setTimeout(() => f.focus(), 0);
  }
  function close() {
    $('ov').hidden = true; document.body.style.overflow = '';
    document.querySelectorAll('.err').forEach(e => { e.hidden = true; });
    edit = null; delArmed = false; resetArmed = false; $('s-reset').textContent = 'Clear all data'; $('s-reset').className = 'btn ghost';
  }
  function err(id, m) { $(id).textContent = m; $(id).hidden = false; }
  const opts = (list, sel) => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');

  // position form
  let edit = null, delArmed = false, quoteTouched = false;
  function openPos(id) {
    const h = S.holdings.find(x => x.id === id); edit = h ? h.id : null; delArmed = false; quoteTouched = !!h;
    $('pos-title').textContent = h ? 'Edit ' + h.code : 'Add position';
    const b = h ? h.broker : (S.settings.filter !== 'All' ? S.settings.filter : 'CMC');
    $('p-code').value = h ? h.code : '';
    $('p-broker').innerHTML = opts(BROKERS, b);
    $('p-type').innerHTML = Object.keys(TYPES).filter(k => k !== 'cash').map(k => `<option value="${k}" ${h && h.type === k ? 'selected' : (!h && k === (b === 'Coinbase' ? 'crypto' : 'stock') ? 'selected' : '')}>${TYPES[k]}</option>`).join('');
    $('p-units').value = h ? h.units : '';
    $('p-avg').value = h && Number.isFinite(h.avgCost) ? h.avgCost : '';
    $('p-costcur').innerHTML = opts(CURS, h ? h.costCurrency : (b === 'CMC' ? 'AUD' : 'USD'));
    $('p-quotecur').innerHTML = opts(CURS, h ? h.quoteCurrency : 'USD');
    $('p-mprice').value = h && Number.isFinite(h.manualPrice) ? h.manualPrice : '';
    $('p-name').value = h ? h.name || '' : '';
    $('p-del').hidden = !h; $('p-del').textContent = 'Delete'; $('p-del').className = 'btn ghost left';
    open('m-pos');
  }
  $('p-quotecur').addEventListener('change', () => { quoteTouched = true; });
  function autoQuote() {
    if (quoteTouched) return;
    const crypto = $('p-type').value === 'crypto';
    const c = C.normCode($('p-code').value, { crypto });
    if (c) $('p-quotecur').value = C.EX_CUR[c.exchange] || 'USD';
  }
  $('p-code').addEventListener('input', autoQuote); $('p-type').addEventListener('change', autoQuote);
  $('p-broker').addEventListener('change', () => { if (!edit && $('p-broker').value === 'Coinbase') { $('p-type').value = 'crypto'; autoQuote(); } });
  $('m-pos').addEventListener('submit', e => {
    e.preventDefault();
    const type = $('p-type').value; const c = C.normCode($('p-code').value, { crypto: type === 'crypto' });
    const units = num($('p-units').value), avg = num($('p-avg').value), mp = num($('p-mprice').value);
    if (!c) return err('p-err', 'Enter a code, for example DUOL:US, BHP.AX or BTC.');
    if (!Number.isFinite(units) || units === 0) return err('p-err', 'Units must be a number other than 0.');
    if (!Number.isFinite(avg) || avg < 0) return err('p-err', 'Avg price must be a number (0 for free shares or rewards).');
    const h = { id: edit || uid(), broker: $('p-broker').value, code: c.code, symbol: c.symbol, exchange: c.exchange, type,
      units, avgCost: avg, costCurrency: $('p-costcur').value, quoteCurrency: $('p-quotecur').value,
      manualPrice: Number.isFinite(mp) ? mp : null, name: $('p-name').value.trim() };
    const i = S.holdings.findIndex(x => x.id === h.id);
    if (i >= 0) S.holdings[i] = h; else S.holdings.push(h);
    save(true); close(); render(); refreshFeeds();
  });
  $('p-del').addEventListener('click', () => {
    if (!delArmed) { delArmed = true; $('p-del').textContent = 'Confirm delete'; $('p-del').className = 'btn danger left'; return; }
    S.holdings = S.holdings.filter(x => x.id !== edit); save(true); close(); render(); refreshFeeds();
  });

  // cash form
  let cashBroker = null;
  function openCash(b) {
    cashBroker = b; const c = S.cash.find(x => x.broker === b);
    $('cash-title').textContent = 'Cash at ' + b;
    $('c-amt').value = c ? c.amount : '';
    $('c-cur').innerHTML = opts(CURS, c ? c.currency : (b === 'CMC' ? 'AUD' : 'USD'));
    open('m-cash');
  }
  $('m-cash').addEventListener('submit', e => {
    e.preventDefault(); const v = $('c-amt').value.trim() === '' ? 0 : num($('c-amt').value);
    if (!Number.isFinite(v)) return err('c-err', 'Enter an amount, for example 0.70.');
    S.cash = S.cash.filter(x => x.broker !== cashBroker);
    if (v) S.cash.push({ broker: cashBroker, amount: v, currency: $('c-cur').value });
    save(true); close(); render();
  });

  // settings
  let resetArmed = false;
  function openSettings() { $('s-key').value = S.settings.finnhubKey || ''; open('m-settings'); }
  $('m-settings').addEventListener('submit', e => {
    e.preventDefault(); const k = $('s-key').value.trim();
    const changed = k !== S.settings.finnhubKey; S.settings.finnhubKey = k; save(true); close();
    if (changed) { notice(null, 'fhbad'); if (fhWs) { fhWs.onclose = null; try { fhWs.close(); } catch (x) { /* */ } fhWs = null; } pollFinnhub(); }
  });
  $('s-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ ...S, settings: { ...S.settings, finnhubKey: '' } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portfolio-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('s-import').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || !Array.isArray(j.holdings)) throw new Error('bad');
      const key = S.settings.finnhubKey; S = normalize(j); if (!S.settings.finnhubKey) S.settings.finnhubKey = key;
      save(true); close(); render(); refreshFeeds();
    } catch (x) { err('s-err', 'That file is not a portfolio backup. Use a file made with Export backup.'); }
  });
  $('s-reset').addEventListener('click', () => {
    if (!resetArmed) { resetArmed = true; $('s-reset').textContent = 'Confirm: delete everything'; $('s-reset').className = 'btn danger'; return; }
    const key = S.settings.finnhubKey;
    S = { v: 1, holdings: [], cash: [], fx: S.fx, fxAt: S.fxAt, quotes: {}, settings: { ...S.settings, filter: 'All', finnhubKey: key } };
    save(true); close(); render(); drawLive();
  });

  // import
  const HELP = {
    CMC: 'Export your holdings from CMC as a CSV. Average prices from CMC are in AUD, so the avg price currency is set to AUD.',
    IBKR: 'Use an IBKR Activity Statement saved as CSV, or a Flex Query CSV that includes open positions. Cost prices are read in each position\'s own currency.',
    Coinbase: 'Best: the Transaction History Report PDF from Coinbase. Its Portfolio Summary lists your exact balances. A CSV also works, but only if its date range covers your whole history, because balances are added up from the transactions.',
    Other: 'Any CSV with a symbol column and a quantity column. Check the column choices below before importing.',
  };
  let det = null, parsed = null;
  function openImport() {
    det = null; parsed = null;
    $('i-broker').innerHTML = opts(BROKERS, S.settings.filter !== 'All' ? S.settings.filter : 'CMC');
    $('i-file').value = ''; $('i-map').hidden = true; $('i-preview').hidden = true; $('i-replace-wrap').hidden = true; $('i-go').disabled = true;
    $('i-help').textContent = HELP[$('i-broker').value];
    open('m-import');
  }
  $('i-broker').addEventListener('change', () => { $('i-help').textContent = HELP[$('i-broker').value]; if (det) analyse(); });
  $('i-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('i-err').hidden = true;
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      $('i-help').textContent = 'Reading PDF…';
      try {
        const lines = await pdfLines(f);
        const r = C.fromCoinbaseSummary(lines);
        if (!r) { det = null; $('i-go').disabled = true; $('i-help').textContent = HELP[$('i-broker').value]; return err('i-err', 'No Portfolio Summary found in this PDF. Use the Coinbase Transaction History Report PDF, or a CSV file.'); }
        if ($('i-broker').value === 'CMC' || $('i-broker').value === 'IBKR') $('i-broker').value = 'Coinbase';
        det = { kind: 'coinbase-pdf' }; parsed = r; $('i-map').hidden = true; preview();
      } catch (x) { $('i-help').textContent = HELP[$('i-broker').value]; err('i-err', 'This PDF could not be read. Check your internet connection (the PDF reader loads from the web) and try again.'); }
      return;
    }
    try { det = C.detect(await f.text(), $('i-broker').value); analyse(); }
    catch (x) { err('i-err', 'This file could not be read as a CSV.'); }
  });
  let pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return pdfLib;
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    pdfLib = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = base + 'pdf.min.js';
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; res(window.pdfjsLib); };
      sc.onerror = () => { pdfLib = null; rej(new Error('pdf.js failed to load')); };
      document.head.appendChild(sc);
    });
    return pdfLib;
  }
  async function pdfLines(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n); const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      items.forEach(it => { const r = rows.find(r => Math.abs(r.y - it.y) < 2.5); if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] }); });
      rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ')));
    }
    return lines;
  }
  const MAP_FIELDS = [['symbol', 'Symbol / code'], ['units', 'Units / quantity'], ['avg', 'Avg price'], ['costTotal', 'Total cost (if no avg price)'],
    ['currency', 'Currency'], ['type', 'Asset type'], ['name', 'Name'], ['price', 'Last price']];
  function analyse() {
    $('i-err').hidden = true;
    const broker = $('i-broker').value;
    if (det.kind === 'empty') { $('i-go').disabled = true; return err('i-err', 'The file is empty.'); }
    if (det.kind === 'table') {
      const g = det.guess; const head = det.headers;
      const sel = (key, label) => `<label>${label}<select data-map="${key}"><option value="-1">— none —</option>${head.map((h, i) => `<option value="${i}" ${g[key] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select></label>`;
      const fixedCur = broker === 'CMC' ? 'AUD' : (g.currency >= 0 ? '' : 'USD');
      $('i-map').innerHTML = MAP_FIELDS.map(([k, l]) => sel(k, l)).join('') +
        `<label>Avg price currency<select id="i-costcur"><option value="">From currency column</option>${opts(CURS, fixedCur)}</select></label>`;
      $('i-map').hidden = false;
      $('i-map').querySelectorAll('select').forEach(s => s.addEventListener('change', buildTable));
      buildTable();
    } else {
      $('i-map').hidden = true;
      parsed = det.kind === 'ibkr-activity' ? C.fromIbkrActivity(det.rows) : C.fromCoinbase(det.rows, det.headerRow);
      preview();
    }
  }
  function buildTable() {
    const map = {}; $('i-map').querySelectorAll('[data-map]').forEach(s => { map[s.dataset.map] = Number(s.value); });
    if (map.symbol < 0 || map.units < 0) { parsed = { positions: [], skipped: [] }; preview(); return err('i-err', 'Choose which columns hold the symbol and the units.'); }
    parsed = C.fromTable(det, map, { costCurrency: $('i-costcur').value || null, crypto: $('i-broker').value === 'Coinbase' });
    preview();
  }
  function preview() {
    const P = parsed.positions;
    $('i-preview').hidden = false; $('i-replace-wrap').hidden = !P.length; $('i-go').disabled = !P.length;
    const kind = det.kind === 'ibkr-activity' ? 'IBKR activity statement' : det.kind === 'coinbase-tx' ? 'Coinbase transaction history' : det.kind === 'coinbase-pdf' ? 'Coinbase report (Portfolio Summary)' : 'table';
    $('i-preview').innerHTML = `<table><thead><tr><th>Code</th><th>Type</th><th>Units</th><th>Avg price</th><th>Cur.</th><th>Quote cur.</th></tr></thead><tbody>` +
      P.map(p => `<tr><td>${esc(p.code)}</td><td>${TYPES[p.type]}</td><td>${fmtU(p.units)}</td><td>${fmtP(p.avgCost)}</td><td>${esc(p.costCurrency)}</td><td>${esc(p.quoteCurrency)}</td></tr>`).join('') +
      `</tbody></table>`;
    const noCost = P.some(p => !Number.isFinite(p.avgCost));
    $('i-help').textContent = `Read as ${kind}: ${P.length} position${P.length === 1 ? '' : 's'} found.` +
      (Number.isFinite(parsed.total) ? ` Report total: ${fmt(parsed.total)} ${parsed.currency || ''}.` : '') +
      (parsed.skipped.length ? ' Skipped: ' + parsed.skipped.join(', ') + '.' : '') +
      (noCost ? ' The file has no average prices: positions you already have keep theirs; add any missing ones with ✎ after importing.' : '');
    if (!P.length && det.kind !== 'table') err('i-err', 'No open positions were found in this file.');
  }
  $('m-import').addEventListener('submit', e => {
    e.preventDefault(); if (!parsed || !parsed.positions.length) return;
    const broker = $('i-broker').value; const replace = $('i-replace').checked;
    const before = S.holdings.filter(h => h.broker === broker);
    if (replace) S.holdings = S.holdings.filter(h => h.broker !== broker);
    parsed.positions.forEach(p => {
      const h = { id: uid(), broker, ...p };
      if (!Number.isFinite(h.avgCost)) {
        const old = before.find(x => x.code === h.code && Number.isFinite(x.avgCost));
        if (old) { h.avgCost = old.avgCost; h.costCurrency = old.costCurrency; }
      }
      const i = S.holdings.findIndex(x => x.broker === broker && x.code === h.code);
      if (i >= 0) S.holdings[i] = { ...h, id: S.holdings[i].id }; else S.holdings.push(h);
    });
    S.settings.filter = 'All'; save(true); close(); render(); refreshFeeds();
  });

  // ---------- global events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button,[data-close]') || e.target;
    if (t.dataset && t.dataset.edit) return openPos(t.dataset.edit);
    if (t.dataset && t.dataset.cash) return openCash(t.dataset.cash);
    if (t.dataset && t.dataset.filter) { S.settings.filter = t.dataset.filter; save(); return draw(); }
    if (t.dataset && t.dataset.cur) { S.settings.display = t.dataset.cur; save(); return draw(); }
    if (t.dataset && t.dataset.donut) { S.settings.donut = t.dataset.donut; save(); return draw(); }
    if (t.dataset && t.dataset.act === 'settings') return openSettings();
    if (t.dataset && t.dataset.act === 'import') return openImport();
    if (t.dataset && t.dataset.act === 'add') return openPos(null);
    if (t.hasAttribute && t.hasAttribute('data-close')) return close();
    if (e.target === $('ov')) return close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ov').hidden) close(); });
  $('btn-add').onclick = () => openPos(null);
  $('btn-import').onclick = openImport;
  $('btn-settings').onclick = openSettings;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshFx(); pollFinnhub(); } });

  // ---------- start ----------
  draw(); drawLive();
  refreshFx(); setInterval(refreshFx, 10 * 60 * 1000);
  refreshFeeds();
})();
