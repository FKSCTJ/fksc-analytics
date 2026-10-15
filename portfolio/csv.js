/* CSV import for CMC, IBKR and Coinbase exports (plus any table with symbol / quantity columns). */
(function (root) {
  'use strict';

  // ---------- low-level parsing ----------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const delim = sniffDelimiter(text);
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(s => s.trim())).filter(r => r.some(s => s !== ''));
  }
  function sniffDelimiter(text) {
    const head = text.split(/\r?\n/).slice(0, 10).join('\n');
    const count = ch => (head.match(new RegExp('\\' + ch, 'g')) || []).length;
    const c = { ',': count(','), ';': count(';'), '\t': count('\t') };
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ',';
  }
  function num(v) {
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s || s === '-' || s === '--') return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[A-Za-z$€£¥\s]/g, '').replace(/[−–]/g, '-');
    // European "1.234,56" -> 1234.56 ; "1,234.56" -> 1234.56 ; "12,5" -> 12.5
    const oneComma = (s.match(/,/g) || []).length === 1;
    // "119,315" (comma + exactly 3 digits, no dot) is a thousands separator, not a decimal
    if (oneComma && !s.includes('.') && /^-?\d{1,3},\d{3}$/.test(s)) s = s.replace(',', '');
    else if (/,\d{1,8}$/.test(s) && oneComma && (!s.includes('.') || s.lastIndexOf('.') < s.indexOf(','))) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }

  // ---------- code / currency normalisation ----------
  const EXCH = {
    US: ['US', 'NASDAQ', 'NYSE', 'XNAS', 'XNYS', 'ARCA', 'NYSEARCA', 'BATS', 'AMEX', 'XASE', 'NMS', 'NYQ', 'PCX'],
    AU: ['AU', 'ASX', 'XASX', 'AX'], UK: ['UK', 'L', 'LSE', 'XLON', 'LN'], CA: ['CA', 'TO', 'TSX', 'XTSE'],
    DE: ['DE', 'XETR', 'XETRA', 'IBIS', 'F', 'FRA'], FR: ['FR', 'PA', 'XPAR', 'SBF'], NL: ['NL', 'AS', 'XAMS', 'AEB'],
    PT: ['PT', 'LS', 'XLIS', 'BVL'], EU: ['EU'], CH: ['CH', 'SW', 'XSWX', 'EBS'], HK: ['HK', 'SEHK', 'XHKG'], JP: ['JP', 'T', 'TSE', 'XTKS'],
  };
  const EX_CUR = { US: 'USD', AU: 'AUD', UK: 'GBP', CA: 'CAD', DE: 'EUR', FR: 'EUR', NL: 'EUR', PT: 'EUR', HK: 'HKD', JP: 'JPY', EU: 'EUR', CH: 'CHF', CRYPTO: 'USD' };
  const CUR_EX = { USD: 'US', AUD: 'AU', GBP: 'UK', GBX: 'UK', CAD: 'CA', HKD: 'HK', JPY: 'JP', EUR: 'EU', CHF: 'CH' };
  const FIAT = ['USD', 'EUR', 'AUD', 'GBP', 'CAD', 'CHF', 'JPY', 'NZD', 'SGD', 'HKD'];
  function exchOf(tag) { tag = String(tag || '').toUpperCase(); for (const k in EXCH) if (EXCH[k].includes(tag)) return k; return null; }

  function normCode(raw, opts) {
    opts = opts || {};
    let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!s) return null;
    if (opts.crypto) {
      const sym = s.replace(/[-/](USD|USDC|USDT|EUR|AUD|GBP)$/, '');
      return { code: sym, symbol: sym, exchange: 'CRYPTO' };
    }
    let sym = s, ex = null, m;
    if ((m = s.match(/^([A-Z]+):([A-Z0-9.\-]+)$/)) && exchOf(m[1]) && !exchOf(m[2])) { ex = exchOf(m[1]); sym = m[2]; }       // XNAS:DUOL
    else if ((m = s.match(/^([A-Z0-9.\-]+):([A-Z]+)$/)) && exchOf(m[2])) { sym = m[1]; ex = exchOf(m[2]); }                     // DUOL:US
    else if ((m = s.match(/^([A-Z0-9\-]+)\.([A-Z]{1,4})$/)) && exchOf(m[2])) { sym = m[1]; ex = exchOf(m[2]); }                // BHP.AX
    if (!ex) ex = (opts.currency && CUR_EX[opts.currency]) || 'US';
    sym = sym.replace(/\s/g, '.');            // IBKR "BRK B" -> BRK.B
    return { code: sym + ':' + ex, symbol: sym, exchange: ex };
  }

  function typeOf(hint, name, crypto) {
    if (crypto) return 'crypto';
    const t = (String(hint || '') + ' ' + String(name || '')).toLowerCase();
    if (/crypto/.test(t)) return 'crypto';
    if (/\betf\b|exchange traded|etp\b|fund/.test(t)) return 'etf';
    if (/cash|forex/.test(t)) return 'cash';
    if (/stock|share|equit|stk/.test(t)) return 'stock';
    return 'stock';
  }

  // ---------- column guessing for generic tables ----------
  const GUESS = {
    symbol: [/^(symbol|ticker|code|stock code|instrument code|asset|security|underlying|product)$/i, /symbol|ticker|code/i, /instrument|asset|security/i],
    name: [/^(name|description|security name|instrument name|company|company name)$/i, /description|name/i],
    units: [/^(quantity|qty|units|shares|position|holding|holdings|balance|amount|no\.? of shares|volume)$/i, /quantity|units|shares|qty/i, /position|balance/i],
    avg: [/^(avg|average)[ _.]*(price|cost)|^cost price$|^costbasisprice$|^average cost$|^avg cost$|purchase price|open price|entry price|price paid/i, /(avg|average).*(price|cost)/i],
    costTotal: [/^(cost|cost basis|total cost|book cost|book value|costbasismoney|purchase value|cost value)$/i, /cost basis|total cost|book cost/i],
    currency: [/^(currency|ccy|currencyprimary|price currency|trading currency|instrument currency)$/i, /currency/i],
    type: [/^(asset category|asset class|assetclass|asset type|security type|sec type|type|instrument type|product type)$/i, /asset (category|class|type)/i],
    price: [/^(last price|last|close price|closeprice|market price|current price|mark price|markprice|price)$/i],
  };
  function guessColumns(headers) {
    headers = headers.map(h => String(h || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim());
    const used = new Set(); const out = {};
    for (const key of ['symbol', 'units', 'avg', 'costTotal', 'currency', 'type', 'name', 'price']) {
      out[key] = -1;
      for (const re of GUESS[key]) {
        const i = headers.findIndex((h, j) => !used.has(j) && re.test(h) && !(key === 'units' && /value|price|cost/i.test(h)));
        if (i >= 0) { out[key] = i; used.add(i); break; }
      }
    }
    return out;
  }
  function findHeaderRow(rows) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const g = guessColumns(rows[i]);
      const score = (g.symbol >= 0 ? 2 : 0) + (g.units >= 0 ? 2 : 0) + (g.avg >= 0 || g.costTotal >= 0 ? 1 : 0) + (g.currency >= 0 ? 0.5 : 0);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  // ---------- format detection ----------
  function detect(text, broker) {
    const rows = parseCSV(text);
    if (!rows.length) return { kind: 'empty', rows: [] };
    if (rows.some(r => r[0] === 'Open Positions' && r[1] === 'Header')) return { kind: 'ibkr-activity', rows };
    const cbIdx = rows.findIndex(r => r.some(c => /^transaction type$/i.test(c)) && r.some(c => /^asset$/i.test(c)));
    if (cbIdx >= 0) return { kind: 'coinbase-tx', rows, headerRow: cbIdx };
    const h = findHeaderRow(rows);
    const headers = rows[h];
    return { kind: 'table', rows, headerRow: h, headers, data: rows.slice(h + 1), guess: guessColumns(headers) };
  }

  // ---------- IBKR activity statement ----------
  function fromIbkrActivity(rows) {
    let headers = null; const out = []; const skipped = [];
    for (const r of rows) {
      if (r[0] !== 'Open Positions') continue;
      if (r[1] === 'Header') { headers = r; continue; }
      if (r[1] !== 'Data' || !headers) continue;
      const o = {}; headers.forEach((h, i) => { o[h] = r[i]; });
      if (o.DataDiscriminator && o.DataDiscriminator !== 'Summary') continue;
      const cat = o['Asset Category'] || '';
      if (/total/i.test(cat) || !o.Symbol) continue;
      if (/forex|cash/i.test(cat)) { skipped.push(o.Symbol + ' (cash)'); continue; }
      const units = num(o.Quantity) * (num(o.Mult) || 1);
      const cur = (o.Currency || 'USD').toUpperCase();
      const crypto = /crypto/i.test(cat);
      const c = normCode(o.Symbol, { currency: cur, crypto });
      if (!c || !Number.isFinite(units) || units === 0) continue;
      let avg = num(o['Cost Price']);
      if (!Number.isFinite(avg)) { const cb = num(o['Cost Basis']); avg = Number.isFinite(cb) && units ? cb / units : NaN; }
      out.push(pos(c, { type: typeOf(cat, o.Description, crypto), units, avgCost: avg, costCurrency: cur, quoteCurrency: crypto ? 'USD' : cur, price: num(o['Close Price']) }));
    }
    return { positions: merge(out), skipped };
  }

  // ---------- Coinbase transaction history ----------
  const CB_IN = /^(buy|advanced trade buy|receive|rewards income|staking income|learning reward|coinbase earn|inflation reward|deposit|incentives rewards payout|reward income|subscription rebates)/i;
  const CB_OUT = /^(sell|advanced trade sell|send|withdrawal|withdraw|retail unstaking transfer fee)/i;
  function fromCoinbase(rows, headerRow) {
    const h = rows[headerRow].map(s => s.toLowerCase());
    const col = (...names) => { for (const n of names) { const i = h.findIndex(x => x === n || x.startsWith(n)); if (i >= 0) return i; } return -1; };
    const iType = col('transaction type'), iAsset = col('asset'), iQty = col('quantity transacted'),
      iCur = col('price currency', 'spot price currency'), iPrice = col('price at transaction', 'spot price at transaction'),
      iSub = col('subtotal'), iTot = col('total (inclusive of fees', 'total'), iNotes = col('notes'), iTime = col('timestamp', 'date');
    const book = {}; let priceCur = null; const skipped = new Set();
    const get = a => (book[a] = book[a] || { units: 0, cost: 0 });
    const data = rows.slice(headerRow + 1).filter(r => r[iType]);
    if (iTime >= 0) data.sort((a, b) => String(a[iTime]).localeCompare(String(b[iTime])));
    for (const r of data) {
      const type = r[iType] || ''; const asset = (r[iAsset] || '').toUpperCase();
      const qty = Math.abs(num(r[iQty])); const price = num(r[iPrice]);
      if (iCur >= 0 && r[iCur]) priceCur = priceCur || r[iCur].toUpperCase();
      if (!asset || !Number.isFinite(qty) || qty === 0) continue;
      if (FIAT.includes(asset)) { skipped.add(asset + ' cash movements'); continue; }
      if (/convert/i.test(type)) {
        const b = get(asset); const share = b.units ? Math.min(1, qty / b.units) : 0; const movedCost = b.cost * share;
        b.units -= qty; b.cost -= movedCost;
        const m = String(r[iNotes] || '').match(/converted\s+([\d.,]+)\s+(\w+)\s+to\s+([\d.,]+)\s+(\w+)/i);
        if (m) { const t = get(m[4].toUpperCase()); t.units += num(m[3]); t.cost += movedCost || Math.abs(num(r[iSub])) || 0; }
        continue;
      }
      if (CB_IN.test(type)) {
        const b = get(asset); b.units += qty;
        const buyCost = /buy/i.test(type) ? Math.abs(num(r[iTot])) : NaN;
        b.cost += Number.isFinite(buyCost) ? buyCost : (Number.isFinite(price) ? qty * price : 0);
      } else if (CB_OUT.test(type)) {
        const b = get(asset); const share = b.units ? Math.min(1, qty / b.units) : 0;
        b.cost -= b.cost * share; b.units -= qty;
      } else { skipped.add(type); continue; }
      // Advanced Trade crypto-to-crypto: "Sold 5.5 ETH for 0.17 BTC" / "Bought 0.0003 BTC for 22.6 USDC"
      const tr = String(r[iNotes] || '').match(/^(bought|sold)\s+([\d.,]+)\s+(\w+)\s+for\s+([\d.,]+)\s+(\w+)/i);
      if (tr && /advanced/i.test(type)) {
        const other = tr[5].toUpperCase(), amt = num(tr[4]);
        if (!FIAT.includes(other) && Number.isFinite(amt) && amt > 0) {
          const o = get(other);
          if (/bought/i.test(tr[1])) { const share = o.units > 0 ? Math.min(1, amt / o.units) : 0; o.cost -= o.cost * share; o.units -= amt; }
          else { o.units += amt; o.cost += Math.abs(num(r[iTot])) || 0; }
        }
      }
    }
    const cur = priceCur || 'USD'; const out = [];
    for (const a in book) {
      const b = book[a]; if (b.units <= 1e-9) continue;
      const c = normCode(a, { crypto: true });
      out.push(pos(c, { type: 'crypto', units: +b.units.toFixed(10), avgCost: b.cost > 0 ? b.cost / b.units : NaN, costCurrency: cur, quoteCurrency: 'USD' }));
    }
    return { positions: out, skipped: [...skipped] };
  }

  // ---------- Coinbase PDF report: "Portfolio Summary" block ----------
  // lines: page text grouped into rows, top to bottom. A holding row reads
  // "<quantity> <price> AUD/BTC <value> AUD" (the asset name sits on its own row).
  function fromCoinbaseSummary(lines, minValue) {
    if (minValue == null) minValue = 0.05;
    const start = lines.findIndex(l => /portfolio summary/i.test(l));
    if (start < 0) return null;
    let end = lines.findIndex((l, i) => i > start && /total market value/i.test(l));
    if (end < 0) end = lines.length;
    const re = /(\d[\d.,]*)\s+(\d[\d.,]*)\s+([A-Z]{3})\s*\/\s*([A-Z0-9]+)\s+(\d[\d.,]*)\s+([A-Z]{3})\b/;
    const out = [], dust = []; let cur = null;
    for (const l of lines.slice(start + 1, end)) {
      const m = l.match(re); if (!m) continue;
      const units = num(m[1]), price = num(m[2]), value = num(m[5]); cur = m[3];
      const c = normCode(m[4], { crypto: true });
      if (!(units > 0)) continue;
      const v = Number.isFinite(value) ? value : units * price;
      if (v < minValue) { dust.push(c.code); continue; }
      out.push(pos(c, { type: 'crypto', units, avgCost: NaN, costCurrency: cur, quoteCurrency: cur, price }));
    }
    let total = NaN;
    for (const l of lines.slice(end, end + 3)) { const t = l.match(/(\d[\d.,]*)\s+([A-Z]{3})\s*$/); if (t) { total = num(t[1]); break; } }
    return { positions: out, skipped: dust.length ? [dust.join(', ') + ' (worth less than ' + minValue + ' ' + (cur || '') + ')'] : [], total, currency: cur };
  }

  // ---------- generic table with a column mapping ----------
  // map: {symbol, units, avg, costTotal, currency, type, name, price} -> column index (-1 = none)
  // fixed: {costCurrency, crypto}
  function fromTable(det, map, fixed) {
    fixed = fixed || {}; const out = [];
    for (const r of det.data) {
      const raw = map.symbol >= 0 ? r[map.symbol] : '';
      if (!raw || /^(total|sub-?total|cash)\b/i.test(raw)) continue;
      const units = num(r[map.units]);
      if (!Number.isFinite(units) || units === 0) continue;
      const cur = (map.currency >= 0 && r[map.currency] ? r[map.currency] : '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
      const typeHint = map.type >= 0 ? r[map.type] : '';
      const name = map.name >= 0 ? r[map.name] : '';
      const crypto = !!fixed.crypto || /crypto/i.test(typeHint);
      const c = normCode(raw, { currency: cur || null, crypto });
      if (!c) continue;
      let avg = map.avg >= 0 ? num(r[map.avg]) : NaN;
      if (!Number.isFinite(avg) && map.costTotal >= 0) { const t = num(r[map.costTotal]); avg = Number.isFinite(t) ? Math.abs(t) / Math.abs(units) : NaN; }
      const quoteCur = crypto ? 'USD' : (EX_CUR[c.exchange] || cur || 'USD');
      out.push(pos(c, {
        type: typeOf(typeHint, name, crypto), units, avgCost: avg, name: name && name !== raw ? name : '',
        costCurrency: fixed.costCurrency || cur || quoteCur, quoteCurrency: quoteCur,
        price: map.price >= 0 ? num(r[map.price]) : NaN,
      }));
    }
    return { positions: merge(out), skipped: [] };
  }

  function pos(c, o) {
    return { code: c.code, symbol: c.symbol, exchange: c.exchange, type: o.type, units: o.units, avgCost: o.avgCost,
      costCurrency: o.costCurrency, quoteCurrency: o.quoteCurrency, name: o.name || '', manualPrice: Number.isFinite(o.price) ? o.price : null };
  }
  function merge(list) {
    const m = new Map();
    for (const p of list) {
      const k = p.code + '|' + p.costCurrency; const e = m.get(k);
      if (!e) { m.set(k, { ...p }); continue; }
      const a = Number.isFinite(e.avgCost) ? e.avgCost : 0, b = Number.isFinite(p.avgCost) ? p.avgCost : 0;
      const u = e.units + p.units; e.avgCost = u ? (a * e.units + b * p.units) / u : NaN; e.units = u;
    }
    return [...m.values()];
  }

  const api = { parseCSV, num, normCode, detect, guessColumns, fromIbkrActivity, fromCoinbase, fromCoinbaseSummary, fromTable, EX_CUR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PortfolioCSV = api;
})(typeof window !== 'undefined' ? window : globalThis);
