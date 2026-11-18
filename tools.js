// worldtab.app free tools: the currency converter and the multi-currency
// spending calculator. One script for both pages and all languages; the page
// says which tool it is (body[data-tool]) and carries its strings in
// #wt-i18n. Built by web/tools-src/build_tools.py, which fills DATA from the
// app's lib/constants.ts so the site and the app agree on currencies and
// fallback rates. Rates come from the same two sources as the app
// (lib/rates.ts): the ECB's daily reference rates via Frankfurter, and
// ExchangeRate-API for TWD, AED and VND. Nothing the visitor types leaves the
// browser; it is kept in localStorage only.
(() => {
  'use strict';
  const DATA = {"currencies": ["USD", "CAD", "CNY", "EUR", "GBP", "JPY", "AUD", "HKD", "KRW", "SGD", "NZD", "TWD", "INR", "MXN", "BRL", "CHF", "THB", "IDR", "PHP", "SEK", "NOK", "DKK", "ZAR", "TRY", "MYR", "PLN", "AED", "VND"], "ecb": ["CAD", "CNY", "EUR", "GBP", "JPY", "AUD", "HKD", "KRW", "SGD", "NZD", "INR", "MXN", "BRL", "CHF", "THB", "IDR", "PHP", "SEK", "NOK", "DKK", "ZAR", "TRY", "MYR", "PLN"], "secondary": ["TWD", "AED", "VND"], "noDecimal": ["JPY", "KRW", "TWD", "IDR", "VND"], "fallback": {"USD": 1.0, "CAD": 1.42, "CNY": 6.7, "EUR": 0.893, "GBP": 0.755, "JPY": 158.0, "AUD": 1.43, "HKD": 7.85, "KRW": 1340.0, "SGD": 1.28, "NZD": 1.78, "TWD": 32.1, "INR": 95.3, "MXN": 18.4, "BRL": 5.02, "CHF": 0.833, "THB": 33.6, "IDR": 17920.0, "PHP": 62.8, "SEK": 9.97, "NOK": 9.52, "DKK": 6.68, "ZAR": 16.5, "TRY": 49.4, "MYR": 4.09, "PLN": 3.91, "AED": 3.6725, "VND": 25900.0}};
  const I = JSON.parse(document.getElementById('wt-i18n').textContent);
  const LANG = document.documentElement.lang || 'en';
  const CUR = DATA.currencies;
  const NO_DEC = DATA.noDecimal;
  const FRANK_URL = 'https://api.frankfurter.dev/v1/latest?from=USD&to=' + DATA.ecb.join(',');
  const SECOND_URL = 'https://open.er-api.com/v6/latest/USD';
  const COMMA_DECIMAL = /^(fr|de|it|es)/.test(LANG);
  const $ = (s) => document.querySelector(s);

  // Per-visitor conveniences only; the page works the same without them.
  const ls = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ── rates ────────────────────────────────────────────────────────────────
  const R = Object.assign({}, DATA.fallback);
  let rateDate = null;
  let ratesLive = false;
  const cached = ls.get('wt_rates_v1');
  if (cached && cached.rates) { Object.assign(R, cached.rates); rateDate = cached.date; ratesLive = !!cached.date; }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  async function refreshRates() {
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < 6 * 3600e3) return false;
    const [a, b] = await Promise.allSettled([getJSON(FRANK_URL), getJSON(SECOND_URL)]);
    let got = false;
    if (a.status === 'fulfilled' && a.value && a.value.rates && typeof a.value.date === 'string') {
      for (const [k, v] of Object.entries(a.value.rates)) if (typeof v === 'number' && v > 0) R[k] = v;
      rateDate = a.value.date; got = true;
    }
    if (b.status === 'fulfilled' && b.value && b.value.result === 'success' && b.value.rates) {
      for (const k of DATA.secondary) { const v = b.value.rates[k]; if (typeof v === 'number' && v > 0) R[k] = v; }
    }
    R.USD = 1;
    if (got) { ratesLive = true; ls.set('wt_rates_v1', { rates: R, date: rateDate, fetchedAt: Date.now() }); }
    return got;
  }
  const conv = (v, from, to) => (v / R[from]) * R[to];

  // ── formatting ───────────────────────────────────────────────────────────
  const decimals = (cur) => (NO_DEC.includes(cur) ? 0 : 2);
  const nf = {};
  function money(v, cur) {
    const d = decimals(cur);
    if (!nf[cur]) {
      try { nf[cur] = new Intl.NumberFormat(LANG, { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }); }
      catch (e) { nf[cur] = { format: (x) => cur + ' ' + x.toFixed(d) }; }
    }
    return nf[cur].format(v);
  }
  let nfRate;
  function rateNum(x) {
    if (!nfRate) { try { nfRate = new Intl.NumberFormat(LANG, { maximumSignificantDigits: 5 }); } catch (e) { nfRate = { format: (y) => String(+y.toPrecision(5)) }; } }
    return nfRate.format(x);
  }
  let dn;
  function curName(c) {
    try { dn = dn || new Intl.DisplayNames([LANG], { type: 'currency' }); return dn.of(c) || c; } catch (e) { return c; }
  }
  function fmtDate(iso) {
    try { return new Intl.DateTimeFormat(LANG, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z')); } catch (e) { return iso; }
  }

  // "1,234.50", "1.234,50", "12,5", "1 234" all read as people mean them.
  function parseAmount(s) {
    s = String(s == null ? '' : s).replace(/[\s  '’]/g, '');
    if (!s) return NaN;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c > -1) { const tail = s.length - c - 1; s = (s.indexOf(',') === c && tail > 0 && tail <= 2) ? s.replace(',', '.') : s.replace(/,/g, ''); }
    else if (d > -1) {
      const many = s.indexOf('.') !== d, tail = s.length - d - 1;
      if (many || (COMMA_DECIMAL && tail === 3)) s = s.replace(/\./g, '');
    }
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  }
  const plain = (v, cur) => v.toFixed(decimals(cur));

  const REGION_CUR = {
    US: 'USD', CA: 'CAD', CN: 'CNY', GB: 'GBP', JP: 'JPY', AU: 'AUD', HK: 'HKD', KR: 'KRW', SG: 'SGD', NZ: 'NZD',
    TW: 'TWD', IN: 'INR', MX: 'MXN', BR: 'BRL', CH: 'CHF', TH: 'THB', ID: 'IDR', PH: 'PHP', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', ZA: 'ZAR', TR: 'TRY', MY: 'MYR', PL: 'PLN', AE: 'AED', VN: 'VND',
    DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR',
  };
  function homeCurrency() {
    for (const l of navigator.languages || [navigator.language]) {
      const m = /-([A-Z]{2})\b/.exec(l || '');
      if (m && REGION_CUR[m[1]]) return REGION_CUR[m[1]];
    }
    return I.defaultCur;
  }
  function fillSelect(sel) {
    for (const c of CUR) {
      const o = document.createElement('option');
      o.value = c; o.textContent = c + ' — ' + curName(c);
      sel.appendChild(o);
    }
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const status = $('#wt-status');
  function showStatus() {
    status.textContent = ratesLive && rateDate ? I.asof.replace('{d}', fmtDate(rateDate)) : I.offline;
    status.classList.toggle('warn', !(ratesLive && rateDate));
  }

  // ── converter ────────────────────────────────────────────────────────────
  function converter() {
    const amt = $('#wt-amount'), from = $('#wt-from'), list = $('#wt-list');
    fillSelect(from);
    const home = homeCurrency();
    const saved = ls.get('wt_conv_v1') || {};
    from.value = CUR.includes(saved.from) ? saved.from : (home === 'USD' ? 'EUR' : 'USD');
    amt.value = typeof saved.amount === 'string' && saved.amount ? saved.amount : '100';
    function render() {
      const f = from.value, v = parseAmount(amt.value);
      const ok = Number.isFinite(v);
      amt.classList.toggle('bad', amt.value.trim() !== '' && !ok);
      list.textContent = '';
      for (const c of [home, ...CUR.filter((x) => x !== home)]) {
        if (c === f) continue;
        const row = el('button', 'wt-row' + (c === home ? ' home' : ''));
        row.type = 'button';
        const left = el('span', 'left');
        left.append(el('span', 'code', c), el('span', 'name', curName(c)));
        if (c === home) left.append(el('span', 'tag', I.home_tag));
        const right = el('span', 'right');
        right.append(el('span', 'val', ok ? money(conv(v, f, c), c) : '—'), el('span', 'rate', '1 ' + f + ' = ' + rateNum(conv(1, f, c)) + ' ' + c));
        row.append(left, right);
        row.addEventListener('click', () => {
          if (ok) amt.value = plain(conv(v, f, c), c);
          from.value = c;
          render();
          amt.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        list.append(row);
      }
      ls.set('wt_conv_v1', { from: f, amount: amt.value });
    }
    amt.addEventListener('input', render);
    from.addEventListener('change', render);
    return render;
  }

  // ── spending calculator ──────────────────────────────────────────────────
  function calculator() {
    const homeSel = $('#wt-home'), rowsEl = $('#wt-rows');
    fillSelect(homeSel);
    const saved = ls.get('wt_calc_v1');
    homeSel.value = saved && CUR.includes(saved.home) ? saved.home : homeCurrency();
    const blank = (cur) => ({ amount: '', cur, note: '' });
    const foreign = () => (homeSel.value === 'USD' ? 'EUR' : 'USD');
    let rows = saved && Array.isArray(saved.rows) && saved.rows.length
      ? saved.rows.filter((r) => r && CUR.includes(r.cur)).map((r) => ({ amount: String(r.amount || ''), cur: r.cur, note: String(r.note || '') }))
      : [];
    if (!rows.length) rows = [blank(foreign())];
    const convEls = [];

    function build() {
      rowsEl.textContent = '';
      convEls.length = 0;
      rows.forEach((r, i) => {
        const line = el('div', 'calc-row');
        const a = el('input', 'amt'); a.inputMode = 'decimal'; a.autocomplete = 'off'; a.placeholder = I.amount_ph; a.value = r.amount;
        a.setAttribute('aria-label', I.amount_ph);
        const s = el('select', 'cur'); fillSelect(s); s.value = r.cur; s.setAttribute('aria-label', I.cur_label);
        const n = el('input', 'note'); n.placeholder = I.note_ph; n.value = r.note; n.maxLength = 60; n.setAttribute('aria-label', I.note_ph);
        const x = el('button', 'rm', '×'); x.type = 'button'; x.title = I.remove; x.setAttribute('aria-label', I.remove);
        const out = el('span', 'conv');
        a.addEventListener('input', () => { r.amount = a.value; update(); });
        s.addEventListener('change', () => { r.cur = s.value; update(); });
        n.addEventListener('input', () => { r.note = n.value; save(); });
        x.addEventListener('click', () => { rows.splice(i, 1); if (!rows.length) rows.push(blank(foreign())); build(); });
        line.append(a, s, n, x, out);
        rowsEl.append(line);
        convEls.push([a, out]);
      });
      update();
    }
    function totals() {
      const home = homeSel.value, by = {};
      let total = 0;
      rows.forEach((r) => {
        const v = parseAmount(r.amount);
        if (!Number.isFinite(v)) return;
        total += conv(v, r.cur, home);
        by[r.cur] = (by[r.cur] || 0) + v;
      });
      return { home, total, by };
    }
    function update() {
      const home = homeSel.value;
      rows.forEach((r, i) => {
        const [a, out] = convEls[i] || [];
        if (!a) return;
        const v = parseAmount(r.amount);
        const ok = Number.isFinite(v);
        a.classList.toggle('bad', r.amount.trim() !== '' && !ok);
        out.textContent = ok && r.cur !== home ? '≈ ' + money(conv(v, r.cur, home), home) : '';
      });
      const t = totals();
      $('#wt-total').textContent = money(t.total, home);
      const parts = Object.keys(t.by).map((c) => money(t.by[c], c));
      $('#wt-bycur').textContent = parts.length > 1 || (parts.length === 1 && !t.by[home]) ? I.by_cur + ': ' + parts.join(' · ') : '';
      save();
    }
    function save() { ls.set('wt_calc_v1', { home: homeSel.value, rows }); }
    homeSel.addEventListener('change', update);
    $('#wt-add').addEventListener('click', () => {
      rows.push(blank(rows.length ? rows[rows.length - 1].cur : foreign()));
      build();
      const inputs = rowsEl.querySelectorAll('input.amt');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('#wt-clear').addEventListener('click', () => { rows = [blank(foreign())]; build(); });
    $('#wt-copy').addEventListener('click', async () => {
      const home = homeSel.value, lines = [];
      rows.forEach((r) => {
        const v = parseAmount(r.amount);
        if (!Number.isFinite(v)) return;
        const head = (r.note.trim() ? r.note.trim() + ': ' : '') + money(v, r.cur);
        lines.push(r.cur === home ? head : head + ' ≈ ' + money(conv(v, r.cur, home), home));
      });
      lines.push(I.total + ': ' + money(totals().total, home));
      lines.push(I.copy_footer.replace('{d}', rateDate ? fmtDate(rateDate) : '—'));
      const text = lines.join('\n'), btn = $('#wt-copy');
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) { /* nothing more to try */ }
        ta.remove();
      }
      btn.textContent = I.copied;
      setTimeout(() => { btn.textContent = I.copy; }, 1600);
    });
    build();
    return update;
  }

  const tool = document.body.dataset.tool;
  const render = tool === 'converter' ? converter() : calculator();
  render();
  if (ratesLive && rateDate) showStatus(); else status.textContent = I.loading;
  refreshRates().then((got) => { if (got) render(); showStatus(); }).catch(showStatus);
})();
