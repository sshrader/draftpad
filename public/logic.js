/* Pure scoring and screening logic. Loaded by the page as window.DraftpadLogic
   and by the tests through require(). No DOM access in here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DraftpadLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  function money(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return '$' + Math.round(n);
  }
  function count(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
  }
  function pct(n) {
    return (Math.round(n * 10) / 10) + '%';
  }
  function ageLabel(h) {
    if (!isNum(h)) return 'n/a';
    return h < 72 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Volume windows: h1 = last hour, h6 = last 6 hours, h24 = last 24 hours (USD).
  function windowsFromSeries(series) {
    const sum = a => a.reduce((x, y) => x + y, 0);
    return { h1: series[series.length - 1], h6: sum(series.slice(-6)), h24: sum(series) };
  }

  // Average hourly volume over the last 6 hours divided by the average over the 18 before.
  function momentum(win) {
    if (!win || !isNum(win.h6) || !isNum(win.h24)) return null;
    const prior = win.h24 - win.h6;
    if (prior <= 0) return win.h6 > 0 ? 99 : null;
    return Math.min(99, (win.h6 / 6) / (prior / 18));
  }

  const WEIGHTS = { buyers: 35, momentum: 30, spread: 20, clean: 15 };

  // Signals with no data are left out and the total is scaled over the weight that remains.
  // opts.buyersFull is the buyer count that earns full marks. It differs by data source and window.
  const BUYERS_FULL = 5000;
  function computeScore(t, opts) {
    const full = opts && isNum(opts.buyersFull) && opts.buyersFull > 0 ? opts.buyersFull : BUYERS_FULL;
    const ratio = momentum(t.win);
    const parts = {
      buyers: isNum(t.buyers) ? clamp(t.buyers / full) * WEIGHTS.buyers : null,
      momentum: ratio === null ? null : clamp((ratio - 0.5) / 2.5) * WEIGHTS.momentum,
      spread: isNum(t.top10) ? clamp((70 - t.top10) / 50) * WEIGHTS.spread : null,
      clean: isNum(t.bundled) ? clamp(1 - t.bundled / 40) * WEIGHTS.clean : null
    };
    let got = 0;
    let avail = 0;
    for (const k of Object.keys(WEIGHTS)) {
      if (parts[k] !== null) { got += parts[k]; avail += WEIGHTS[k]; }
    }
    const total = avail ? Math.round(got / avail * 100) : 0;
    return { parts, total, ratio, coverage: avail };
  }

  // Check statuses: pass, watch, fail, or na (no data in this feed, ignored for the overall status).
  function evaluate(t, f) {
    const checks = [];
    const add = (label, value, limit, status) => checks.push({ label, value, limit, status });

    if (isNum(t.liq)) add('Liquidity', money(t.liq), 'min ' + money(f.minLiq), t.liq < f.minLiq ? 'fail' : (t.liq < f.minLiq * 2 ? 'watch' : 'pass'));
    else add('Liquidity', 'No data', 'min ' + money(f.minLiq), 'watch');

    if (isNum(t.ageH)) add('Age', ageLabel(t.ageH), 'min ' + f.minAge + 'h', t.ageH < f.minAge ? 'fail' : (t.ageH < f.minAge * 2 ? 'watch' : 'pass'));
    else add('Age', 'No data', 'min ' + f.minAge + 'h', 'watch');

    if (isNum(t.top10)) add('Top holders', pct(t.top10), 'max ' + f.maxTop10 + '%', t.top10 > f.maxTop10 ? 'fail' : (t.top10 > f.maxTop10 - 8 ? 'watch' : 'pass'));
    else add('Top holders', 'No data', 'max ' + f.maxTop10 + '%', 'watch');

    if (isNum(t.bundled)) add('Bundled buys', pct(t.bundled), 'max ' + f.maxBundled + '%', t.bundled > f.maxBundled ? 'fail' : (t.bundled > f.maxBundled - 6 ? 'watch' : 'pass'));
    else add('Bundled buys', 'No data', 'not scored', 'na');

    const authority = (label, revoked) => {
      if (revoked === true) add(label, 'Revoked', f.needRevoked ? 'must be revoked' : '', 'pass');
      else if (revoked === false) add(label, 'Still active', f.needRevoked ? 'must be revoked' : '', f.needRevoked ? 'fail' : 'watch');
      else add(label, 'Unknown', f.needRevoked ? 'must be revoked' : '', f.needRevoked ? 'fail' : 'watch');
    };
    authority('Mint authority', t.mintRevoked);
    authority('Freeze authority', t.freezeRevoked);

    if (typeof t.sus === 'boolean') add('Jupiter audit flag', t.sus ? 'Flagged suspicious' : 'No flag', '', t.sus ? 'fail' : 'pass');
    if (isNum(t.devPct)) add('Dev balance', pct(t.devPct), 'watch above 10%, fail above 25%', t.devPct > 25 ? 'fail' : (t.devPct > 10 ? 'watch' : 'pass'));

    const status = checks.some(c => c.status === 'fail') ? 'fail' : (checks.some(c => c.status === 'watch') ? 'watch' : 'pass');
    return { checks, status };
  }

  // True when the token is no older than maxH hours. maxH of 0 means any age. Unknown age is out of scope when a limit is set.
  function withinAge(t, maxH) {
    if (!maxH) return true;
    return isNum(t.ageH) && t.ageH <= maxH;
  }

  const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // True for a well-formed Solana address (base58, 32 to 44 characters).
  const isMint = s => typeof s === 'string' && MINT_RE.test(s);

  // Side-by-side terms for a vamp offer. The original's numbers come from the feed and are
  // "n/a" when the feed lacks them; the right-hand side is what the creator has set (planned).
  // p: { platformFeePct, creatorFeePct, walletCapPct (0 = none), vestDays (0 = none), bonusPct, claimDays }
  function vampTerms(t, p) {
    const auth = v => (v === true ? 'Revoked' : (v === false ? 'Still active' : 'Unknown'));
    return [
      { label: 'Liquidity', original: isNum(t.liq) ? money(t.liq) : 'n/a', yours: 'Seeded by you at launch' },
      { label: 'Top holders', original: isNum(t.top10) ? pct(t.top10) + ' of supply' : 'n/a', yours: p.walletCapPct > 0 ? 'Max ' + p.walletCapPct + '% per wallet, first 10 min' : 'No wallet cap' },
      { label: 'Mint authority', original: auth(t.mintRevoked), yours: 'Revoked at launch' },
      { label: 'Freeze authority', original: auth(t.freezeRevoked), yours: 'Revoked at launch' },
      { label: 'Dev holding', original: isNum(t.devPct) ? pct(t.devPct) : 'n/a', yours: p.vestDays > 0 ? 'Vested over ' + p.vestDays + ' days' : 'Not vested' },
      { label: 'Trading fee', original: 'Not in feed', yours: (p.platformFeePct + p.creatorFeePct).toFixed(2) + '%' },
      { label: 'Holder bonus', original: 'None', yours: p.bonusPct > 0 ? p.bonusPct + '% of supply, claim within ' + p.claimDays + ' days' : 'None' }
    ];
  }

  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function lev(a, b) {
    const m = [];
    for (let i = 0; i <= a.length; i++) m[i] = [i];
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return m[a.length][b.length];
  }
  // True when a proposed name or ticker would read as the original token's.
  function tooClose(input, original, isTicker) {
    const a = norm(input);
    const b = norm(original);
    if (!a) return false;
    if (a === b) return true;
    if (!isTicker && a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
    const tol = isTicker ? 1 : (Math.max(a.length, b.length) <= 5 ? 1 : 2);
    return lev(a, b) <= tol;
  }

  return { isNum, clamp, money, count, pct, ageLabel, esc, windowsFromSeries, momentum, WEIGHTS, BUYERS_FULL, computeScore, evaluate, withinAge, isMint, vampTerms, tooClose };
});
