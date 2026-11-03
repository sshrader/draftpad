/* Draftpad page logic: loads the live feed (falling back to sample data), renders the
   manifest and pad panel, and runs the launch form. Depends on logic.js and sample.js. */
(function () {
  'use strict';

  const L = window.DraftpadLogic;
  // Sample tokens carry a 24h volume only; the page reads the volume for the chosen window as `vol`.
  const SAMPLE = window.DraftpadSample.SAMPLE.map(t => Object.assign({ vol: t.vol24 }, t));
  const { isNum, money, count, pct, ageLabel, esc, computeScore, evaluate, withinAge, isMint, PRESETS, splitFee, vampTerms, tooClose, WEIGHTS, BUYERS_FULL } = L;
  const $ = id => document.getElementById(id);

  const REFRESH_MS = 5 * 60 * 1000;
  const WIN_LABEL = { '5m': '5 minutes', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours' };
  // Jupiter's organic-buyer counts are small. These are the counts that earn full marks per window.
  const LIVE_BUYERS_FULL = { '5m': 20, '1h': 60, '6h': 200, '24h': 500 };
  const STATUS = { pass: ['pass', '● GO'], watch: ['watch', '▲ HOLD'], fail: ['fail', '✕ NO-GO'] };
  const CHECK_TAG = { pass: 'PASS', watch: 'WATCH', fail: 'FAIL', na: 'N/A' };

  const state = { f: { minLiq: 25000, minAge: 1, maxTop10: 45, maxBundled: 20, needRevoked: true }, maxAge: 168, win: '1h', sort: 'score', sel: null, vamp: false, tab: 'details' };
  let TOKENS = SAMPLE;
  let mode = 'sample';
  let view = { top: [], passing: [], held: [], tooOld: 0 };
  let loadSeq = 0;
  let ageTouched = false;

  /* ---------- Data ---------- */
  // Which window the numbers describe: sample data is always 24h.
  function activeWin() { return mode === 'live' ? state.win : '24h'; }
  function buyersFull() { return mode === 'live' ? LIVE_BUYERS_FULL[state.win] : BUYERS_FULL; }

  function compute() {
    const inScope = TOKENS.filter(t => withinAge(t, state.maxAge));
    const sc = { buyersFull: buyersFull(), fast: mode === 'live' };
    const rows = inScope.map(t => ({ t, ev: evaluate(t, state.f), sc: computeScore(t, sc) }));
    const key = {
      score: r => r.sc.total,
      vol: r => r.t.vol,
      buyers: r => (isNum(r.t.buyers) ? r.t.buyers : -1),
      chg: r => (isNum(r.t.chg) ? r.t.chg : -Infinity)
    }[state.sort];
    const passing = rows.filter(r => r.ev.status !== 'fail').sort((a, b) => key(b) - key(a) || b.t.vol - a.t.vol);
    const held = rows.filter(r => r.ev.status === 'fail');
    view = { top: passing.slice(0, 10), passing, held, tooOld: TOKENS.length - inScope.length };
    if (!view.top.some(r => r.t.id === state.sel)) state.sel = view.top.length ? view.top[0].t.id : null;
  }

  function markStyle(sym) {
    let h = 0;
    for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return 'background:hsl(' + h + ' 38% 20%);color:hsl(' + h + ' 75% 78%);border:1px solid hsl(' + h + ' 35% 32%)';
  }
  function changeText(chg) {
    return isNum(chg) ? (chg >= 0 ? '+' : '') + Math.round(chg) + '%' : '–';
  }

  /* ---------- Contract address ---------- */
  function shortCa(id) { return id.slice(0, 6) + '…' + id.slice(-6); }
  // Sits beside the row, never inside it, because a button cannot hold another button.
  function caStrip(t) {
    if (!isMint(t.id)) {
      return '<div class="castrip"><span class="calab">CA</span><span class="muted">Sample token, no address</span></div>';
    }
    return '<div class="castrip"><span class="calab">CA</span><code class="cavalue" title="' + esc(t.id) + '">' + esc(shortCa(t.id)) + '</code>' +
      '<button type="button" class="ca-copy" data-ca="' + esc(t.id) + '" aria-label="Copy contract address for ' + esc(t.name) + '">Copy</button>' +
      '<a class="ca-link" href="https://solscan.io/token/' + esc(t.id) + '" target="_blank" rel="noopener noreferrer">Solscan ↗</a></div>';
  }

  // Copy with a fallback that selects the address when the clipboard is blocked.
  document.addEventListener('click', e => {
    const b = e.target.closest('.ca-copy');
    if (!b) return;
    const ca = b.dataset.ca;
    const flash = msg => { b.textContent = msg; setTimeout(() => { b.textContent = 'Copy'; }, 1600); };
    const select = () => {
      const code = b.parentNode.querySelector('.cavalue');
      code.textContent = ca;
      const rg = document.createRange();
      rg.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rg);
      flash('Select + copy');
    };
    try {
      navigator.clipboard.writeText(ca).then(() => flash('Copied'), select);
    } catch (err) { select(); }
  });

  /* ---------- Manifest ---------- */
  function renderBoard() {
    const rows = $('rows');
    if (!view.top.length) {
      rows.innerHTML = '<div class="empty">No token clears these limits. Loosen a setting above.</div>';
    } else {
      rows.innerHTML = view.top.map((r, i) => {
        const t = r.t;
        const s = STATUS[r.ev.status];
        const cls = isNum(t.chg) ? (t.chg >= 0 ? ' up' : ' down') : '';
        const initials = Array.from(t.sym).slice(0, 2).join('');
        return '<div class="rowbox"><button type="button" class="row" data-id="' + esc(t.id) + '" aria-pressed="' + (t.id === state.sel) + '">' +
          '<span class="rank">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="mark" style="' + markStyle(t.sym) + '">' + esc(initials) + '</span>' +
          '<span class="who"><b>' + esc(t.name) + '</b><i>$' + esc(t.sym) + ' · ' + ageLabel(t.ageH) + ' old</i></span>' +
          '<span class="stats">' +
          '<span class="num' + cls + '" data-l="' + activeWin() + '">' + changeText(t.chg) + '</span>' +
          '<span class="num" data-l="Vol">' + money(t.vol) + '</span>' +
          '<span class="num" data-l="Buyers">' + (isNum(t.buyers) ? count(t.buyers) : '–') + '</span></span>' +
          '<span class="scorecell"><em>' + r.sc.total + '</em><span class="bar"><span style="width:' + r.sc.total + '%"></span></span></span>' +
          '<span class="pill ' + s[0] + '">' + s[1] + '</span></button>' + caStrip(t) + '</div>';
      }).join('');
    }
    $('count').textContent = 'Showing ' + view.top.length + ' of ' + view.passing.length + ' passing · ' + view.held.length + ' held back' +
      (view.tooOld ? ' · ' + view.tooOld + ' older than ' + maxAgeText() + ' hidden' : '');
    renderWinUi();
    const held = $('held');
    held.hidden = !view.held.length;
    held.innerHTML = '<summary>Held back by range safety (' + view.held.length + ')</summary><ul>' +
      view.held.map(r => '<li><b>' + esc(r.t.name) + '</b><span class="mono muted">$' + esc(r.t.sym) + '</span><span class="why">' +
        esc(r.ev.checks.filter(c => c.status === 'fail').map(c => c.label + ' ' + c.value + (c.limit ? ' (' + c.limit + ')' : '')).join(' · ')) +
        '</span></li>').join('') + '</ul>';
  }

  function maxAgeText() {
    return state.maxAge % 24 === 0 ? state.maxAge / 24 + 'd' : state.maxAge + 'h';
  }

  // Window toggle, column heading, headline and sort labels follow the chosen window.
  function renderWinUi() {
    const w = activeWin();
    const liveMode = mode === 'live';
    Array.from(document.querySelectorAll('#win button')).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.win === w));
      b.disabled = !liveMode;
    });
    $('win-note').textContent = liveMode ? '' : 'Sample data is 24h only';
    $('col-chg').textContent = w;
    $('win-text').textContent = 'last ' + WIN_LABEL[w];
    const opts = $('c-sort').options;
    for (const o of opts) {
      if (o.value === 'vol') o.textContent = w + ' volume';
      if (o.value === 'chg') o.textContent = w + ' change';
      if (o.value === 'buyers') o.textContent = 'Unique buyers';
    }
    $('how-buyers').textContent = count(buyersFull());
    $('how-mom').textContent = liveMode ? 'the last hour against the 5 before, since live tokens fade fast' : 'the last 6 hours against the 18 before';
  }

  /* ---------- Pad panel ---------- */
  function renderSpark(t) {
    const title = $('p-spark-title');
    const axis = $('p-axis');
    const box = $('p-spark');

    if (Array.isArray(t.series)) {
      title.textContent = 'Hourly volume, last 24h';
      const max = Math.max.apply(null, t.series);
      box.innerHTML = '<svg class="spark" viewBox="0 0 240 64" preserveAspectRatio="none" role="img" aria-label="Hourly volume for the last 24 hours">' +
        t.series.map((v, i) => {
          const h = Math.max(2, v / max * 62);
          return '<rect class="' + (i >= 18 ? 'hot' : '') + '" x="' + (i * 10) + '" y="' + (64 - h).toFixed(1) + '" width="8" height="' + h.toFixed(1) + '"/>';
        }).join('') + '</svg>';
      axis.className = 'axis';
      axis.innerHTML = '<span>-24h</span><span>now</span>';
      return;
    }

    title.textContent = 'Average volume per hour, by window';
    const w = t.win || {};
    const bars = [];
    if (isNum(w.h24) && isNum(w.h6) && w.h24 > w.h6) bars.push({ label: 'prior 18h', v: (w.h24 - w.h6) / 18 });
    if (isNum(w.h1) && isNum(w.h6) && w.h6 >= w.h1) bars.push({ label: 'prior 5h', v: (w.h6 - w.h1) / 5 });
    if (isNum(w.h1)) bars.push({ label: 'last 1h', v: w.h1 });
    else if (isNum(w.h6)) bars.push({ label: 'last 6h', v: w.h6 / 6 });
    if (bars.length < 2) {
      box.innerHTML = '<p class="hint">The feed has no volume breakdown for this token.</p>';
      axis.innerHTML = '';
      return;
    }
    const n = bars.length;
    const gap = 12;
    const bw = (240 - gap * (n - 1)) / n;
    const max = Math.max.apply(null, bars.map(b => b.v)) || 1;
    box.innerHTML = '<svg class="spark" viewBox="0 0 240 64" preserveAspectRatio="none" role="img" aria-label="Average hourly volume by time window">' +
      bars.map((b, i) => {
        const h = Math.max(2, b.v / max * 62);
        return '<rect class="' + (i === n - 1 ? 'hot' : '') + '" x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (64 - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
      }).join('') + '</svg>';
    axis.className = 'axis cols';
    axis.innerHTML = bars.map(b => '<span>' + b.label + '<br><b>' + money(b.v) + '/h</b></span>').join('');
  }

  function renderPad(keepForm) {
    const r = view.top.find(x => x.t.id === state.sel);
    $('pad-empty').hidden = !!r;
    $('pad-body').hidden = !r;
    if (!r) return;
    const t = r.t;
    const pos = view.top.indexOf(r) + 1;

    $('p-no').textContent = 'PAD ' + String(pos).padStart(2, '0');
    $('p-name').textContent = t.name;
    $('p-sub').textContent = '$' + t.sym + ' · ' + money(t.vol) + ' ' + activeWin() + ' volume · ' + changeText(t.chg) + ' · ' +
      (isNum(t.holders) ? count(t.holders) + ' holders' : 'holders n/a');
    $('p-ca').innerHTML = caStrip(t);
    renderSpark(t);

    $('p-total').textContent = r.sc.total + ' / 100';
    const labels = {
      buyers: 'Unique buyers, ' + activeWin() + ' (' + (isNum(t.buyers) ? count(t.buyers) : 'no data') + ')',
      momentum: 'Volume momentum (' + (r.sc.ratio === null ? 'no data' : r.sc.ratio.toFixed(1) + 'x') + ')',
      spread: 'Holder spread (top holders own ' + (isNum(t.top10) ? pct(t.top10) : 'no data') + ')',
      clean: 'Bundle cleanliness (' + (isNum(t.bundled) ? pct(t.bundled) + ' bundled' : 'no data') + ')'
    };
    $('p-parts').innerHTML = Object.keys(WEIGHTS).map(k => {
      const p = r.sc.parts[k];
      if (p === null) return '<div class="part"><span>' + labels[k] + '</span><span class="pts">not scored</span></div>';
      return '<div class="part"><span>' + labels[k] + '</span><span class="pts">' + p.toFixed(1) + '/' + WEIGHTS[k] +
        '</span><span class="bar"><span style="width:' + (p / WEIGHTS[k] * 100).toFixed(0) + '%"></span></span></div>';
    }).join('') + (r.sc.coverage < 100
      ? '<p class="hint" style="margin:6px 0 0">Scaled over the ' + r.sc.coverage + ' of 100 weight that has data.</p>' : '');

    $('p-checks').innerHTML = r.ev.checks.map(c =>
      '<li class="chk ' + c.status + '"><span class="ck">' + CHECK_TAG[c.status] + '</span><span>' + c.label +
      '<span class="cv">' + esc(c.value) + (c.limit ? ' · ' + c.limit : '') + '</span></span></li>').join('');

    $('l-src').textContent = t.name + ' ($' + t.sym + ')';
    renderVamp(r);
    if (!keepForm) {
      $('sheet').hidden = true;
      ['e-name', 'e-sym', 'e-art'].forEach(id => { $(id).hidden = true; });
    }
  }

  /* ---------- Vamp offer ---------- */
  function presetId() {
    const el = document.querySelector('#presets input:checked');
    return el ? el.value : 'standard';
  }
  function feeSplit() {
    const pr = PRESETS.find(x => x.id === presetId()) || PRESETS[1];
    return Object.assign({ preset: pr.id }, splitFee(pr.total, pr.share));
  }

  function vampPlan() {
    const f = feeSplit();
    return {
      platformFeePct: f.platform, creatorFeePct: f.creator,
      walletCapPct: +$('f-cap').value,
      bonusPct: +$('f-bonus').value, claimDays: +$('f-claim').value
    };
  }

  function renderVamp(r) {
    r = r || view.top.find(x => x.t.id === state.sel);
    if (!r) return;
    const t = r.t;
    const v = state.vamp;
    Array.from(document.querySelectorAll('#ptabs button')).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab)));
    $('p-details').hidden = state.tab !== 'details';
    $('p-launch').hidden = state.tab === 'details';
    $('vamp').hidden = !v;
    $('v-badge').hidden = !v;
    $('v-badge').textContent = 'Vamp of ' + t.name;
    $('o-bonus').textContent = $('f-bonus').value + '%';
    $('l-hint').textContent = v
      ? 'Your token keeps its own name, ticker and artwork. The offer gives holders of ' + t.name + ' a reason to move, and they choose whether to.'
      : 'Pick your own name, ticker and artwork, then set your own fees and pairing. The original token\'s identity is not reused.';
    $('credit').textContent = v
      ? 'Listing credit, always on: "Vamp offer for holders of ' + t.name + ' ($' + t.sym + '). Not affiliated. The original token is unchanged."'
      : 'Listing credit, always on: "Inspired by ' + t.name + ' ($' + t.sym + '). Not affiliated."';
    $('launch').querySelector('.go-btn[type=submit]').textContent = v ? 'Stage vamp offer' : 'Stage launch';
    if (v) {
      $('cmp').innerHTML = '<div class="h">Term</div><div class="h">Original</div><div class="h">Yours (planned)</div>' +
        vampTerms(t, vampPlan()).map(row => '<div class="k">' + esc(row.label) + '</div><div>' + esc(row.original) + '</div><div class="y">' + esc(row.yours) + '</div>').join('');
    }
  }

  // The panel has three views, so the launch form is one tap from the top instead of a scroll away.
  $('ptabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.tab = b.dataset.tab;
    state.vamp = state.tab === 'vamp';
    $('sheet').hidden = true;
    renderVamp();
  });
  ['f-cap', 'f-bonus', 'f-claim'].forEach(id => $(id).addEventListener('input', () => renderVamp()));

  function renderAll() {
    compute();
    renderBoard();
    renderPad(false);
  }

  /* ---------- Filters and selection ---------- */
  function readFilters() {
    state.f.minLiq = +$('c-liq').value;
    state.f.minAge = +$('c-age').value;
    state.f.maxTop10 = +$('c-top').value;
    state.f.maxBundled = +$('c-bun').value;
    state.f.needRevoked = $('c-auth').checked;
    state.maxAge = +$('c-maxage').value;
    state.sort = $('c-sort').value;
    $('o-top').textContent = state.f.maxTop10 + '%';
    $('o-bun').textContent = state.f.maxBundled + '%';
    renderAll();
  }
  $('c-maxage').addEventListener('input', () => { ageTouched = true; });
  ['c-liq', 'c-age', 'c-maxage', 'c-top', 'c-bun', 'c-auth', 'c-sort'].forEach(id => $(id).addEventListener('input', readFilters));

  $('rows').addEventListener('click', e => {
    const b = e.target.closest('.row');
    if (!b) return;
    state.sel = b.dataset.id;
    renderBoard();
    renderPad(false);
    if (window.matchMedia('(max-width: 999px)').matches) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('pad').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
  });

  /* ---------- Live feed ---------- */
  function setFeedUi(text, live) {
    $('feed-text').textContent = text;
    $('feed-led').className = 'led' + (live ? ' live' : '');
  }

  const LIVE_NOTE = 'Live data comes from Jupiter\'s token API through this site\'s server and refreshes every few minutes. ' +
    'Each list merges the trending, most-traded and newest tokens, so fresh launches are not buried under older names. ' +
    'Bundled-buy share is not in that feed, so it shows as no data and is left out of the score. ' +
    'Token names and symbols come from the market and can be misleading, so treat each one as untrusted.';

  function sampleNote(why) {
    const reason = why === 'not_configured'
      ? 'The server has no Jupiter API key yet, so the live feed is off.'
      : 'The live feed did not respond, so sample data is showing.';
    return 'These 15 tokens are fictional sample data. ' + reason;
  }

  async function loadLive(win) {
    try {
      const res = await fetch('/api/trending?window=' + encodeURIComponent(win), { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !Array.isArray(body.tokens) || !body.tokens.length) {
        return { ok: false, why: body && body.error ? body.error : 'http_' + res.status };
      }
      return { ok: true, body };
    } catch (err) {
      return { ok: false, why: 'network' };
    }
  }

  function applyFeed(r) {
    const prevSel = state.sel;
    const prevMode = mode;
    if (r.ok) {
      TOKENS = r.body.tokens;
      mode = 'live';
      const when = new Date(r.body.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setFeedUi('Live · Jupiter · updated ' + when + (r.body.stale ? ' · stale' : ''), true);
      $('foot').textContent = LIVE_NOTE;
    } else {
      TOKENS = SAMPLE;
      mode = 'sample';
      setFeedUi('Sample data · 15 fictional tokens', false);
      $('foot').textContent = sampleNote(r.why);
    }
    // Until the person picks one, live data defaults to tokens under a day old and sample data to a week.
    if (!ageTouched) {
      const v = mode === 'live' ? '24' : '168';
      $('c-maxage').value = v;
      state.maxAge = +v;
    }
    compute();
    renderBoard();
    renderPad(prevMode === mode && prevSel === state.sel);
  }

  // Fetch the chosen window. Only the newest request may change the page, so a slow
  // answer for a window the person already left cannot overwrite the current one.
  function refresh() {
    const seq = ++loadSeq;
    const win = state.win;
    return loadLive(win).then(r => { if (seq === loadSeq) applyFeed(r); });
  }

  $('win').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.dataset.win === state.win) return;
    state.win = b.dataset.win;
    setFeedUi('Loading ' + state.win + ' window…', false);
    renderWinUi();
    refresh();
  });

  /* ---------- Launch form ---------- */
  // Preset cards are built from the shared list so the page and the server cannot drift apart.
  $('presets').insertAdjacentHTML('beforeend', PRESETS.map(pr =>
    '<label class="preset"><input type="radio" name="preset" value="' + esc(pr.id) + '"' + (pr.id === 'standard' ? ' checked' : '') + '>' +
    '<b>' + esc(pr.label) + ' · ' + pr.total.toFixed(2) + '% fee</b>' +
    '<span>Creator keeps ' + pr.share + '%. ' + esc(pr.blurb) + '</span></label>').join(''));

  function feeLine() {
    const f = feeSplit();
    $('fee-line').textContent = 'Each trade pays ' + f.total.toFixed(2) + '%: creator ' + f.creator.toFixed(2) + '%, platform ' +
      f.platform.toFixed(2) + '%. Early trades pay a higher fee that decays to this, as anti-sniper protection (prototype defaults).';
  }
  $('presets').addEventListener('change', () => { feeLine(); renderVamp(); });
  feeLine();

  function showErr(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.hidden = false;
  }

  let artFile = null;
  $('f-art').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    artFile = null;
    $('art-prev').innerHTML = '';
    $('e-art').hidden = true;
    if (!f) return;
    if (!f.type.startsWith('image/')) { showErr('e-art', 'Choose an image file.'); return; }
    if (f.size > 2000000) { showErr('e-art', 'Use an image under 2 MB.'); return; }
    artFile = f;
    const rd = new FileReader();
    rd.onload = () => {
      const im = document.createElement('img');
      im.alt = 'Preview of your artwork';
      im.src = rd.result;
      $('art-prev').appendChild(im);
    };
    rd.readAsDataURL(f);
  });

  $('launch').addEventListener('submit', e => {
    e.preventDefault();
    const r = view.top.find(x => x.t.id === state.sel);
    if (!r) return;
    const name = $('f-name').value.trim();
    const sym = $('f-sym').value.trim().replace(/^\$/, '');
    let ok = true;
    ['e-name', 'e-sym', 'e-art'].forEach(id => { $(id).hidden = true; });
    if (!name) { showErr('e-name', 'Enter a name for your token.'); ok = false; }
    else if (tooClose(name, r.t.name, false)) { showErr('e-name', 'That reads too much like ' + r.t.name + '. Pick a name that stands on its own.'); ok = false; }
    if (!sym) { showErr('e-sym', 'Enter a ticker.'); ok = false; }
    else if (tooClose(sym, r.t.sym, true)) { showErr('e-sym', 'That ticker is too close to $' + r.t.sym + '. Pick a different one.'); ok = false; }
    if (!artFile) { showErr('e-art', 'Add your own artwork. The original token\'s art is not reused.'); ok = false; }
    if (!ok) return;

    const fee = feeSplit();
    const cfg = {
      token: { name: name, ticker: '$' + sym.toUpperCase(), artwork: artFile.name },
      inspiredBy: { name: r.t.name, ticker: '$' + r.t.sym, listingCredit: (state.vamp ? 'Vamp offer for holders of ' : 'Inspired by ') + r.t.name + '. Not affiliated.' },
      pairsAgainst: $('f-quote').value,
      fees: { preset: fee.preset, totalPct: fee.total, creatorSharePct: fee.creatorSharePct, creatorPct: fee.creator, platformPct: fee.platform },
      walletCapFirst10Min: $('f-cap').value === '0' ? 'none' : $('f-cap').value + '% of supply',
      creatorAllocation: 'none, the creator buys on the curve like everyone else',
      status: 'staged in prototype, not deployed'
    };
    if (state.vamp) {
      const plan = vampPlan();
      cfg.vampOffer = {
        original: { name: r.t.name, ticker: '$' + r.t.sym, mint: r.t.id },
        holderBonusPctOfSupply: plan.bonusPct,
        claimWindowDays: plan.claimDays,
        unclaimed: 'burned',
        optInClaim: true,
        originalTokenAffected: false,
        termsCompared: vampTerms(r.t, plan).map(x => ({ term: x.label, original: x.original, yours: x.yours }))
      };
    }
    $('sheet-json').textContent = JSON.stringify(cfg, null, 2);
    document.dispatchEvent(new CustomEvent('draftpad:staged', { detail: { name: name, symbol: sym, preset: fee.preset, vamp: state.vamp } }));
    $('copied').hidden = true;
    $('sheet').hidden = false;
    $('sheet').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  });

  $('copy').addEventListener('click', () => {
    const pre = $('sheet-json');
    const note = $('copied');
    const done = msg => { note.textContent = msg; note.hidden = false; };
    const select = () => {
      const rg = document.createRange();
      rg.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rg);
      done('Press copy on your keyboard to finish.');
    };
    try {
      navigator.clipboard.writeText(pre.textContent).then(() => done('Copied.'), select);
    } catch (err) { select(); }
  });

  /* ---------- Start ---------- */
  $('c-maxage').value = String(state.maxAge);
  setFeedUi('Loading live feed…', false);
  $('foot').textContent = '';
  renderAll();
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
