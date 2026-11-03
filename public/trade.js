/* Trade card: look up a Draftpad launch by its pool address, see how full its curve is, and buy
   with SOL. The server prepares the swap, your wallet signs it. Devnet only. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const W = window.DraftpadWallet;
  const L = window.DraftpadLogic;

  let pool = null; // last loaded pool info
  let busy = false;

  function say(text, bad) {
    const el = $('t-status');
    el.textContent = text;
    el.className = 'dl-status' + (bad ? ' bad' : '');
  }

  function fail(msg) {
    const el = $('t-err');
    el.textContent = msg;
    el.hidden = !msg;
  }

  const WHY = {
    bad_pool: 'That is not a valid pool address.',
    pool_not_found: 'No pool found at that address on devnet.',
    not_a_draftpad_pool: 'That pool was not launched through Draftpad.',
    rate_limited: 'Too many requests. Wait a minute.',
    bad_amount: 'Enter an amount between 0.01 and 5 SOL.',
    curve_full: 'The curve is full and moving to its DEX pool, so there is nothing left to buy here.',
    migrated: 'This token has moved to its DEX pool and cannot be bought here any more.',
    launch_unavailable: 'Trading is not switched on for this site.'
  };

  function renderInfo() {
    const info = $('t-info');
    info.hidden = !pool;
    if (!pool) return;
    const pct = Math.round(pool.progress * 100);
    $('t-bar').style.width = pct + '%';
    $('t-prog').textContent = pool.raisedSol.toFixed(3) + ' of ' + pool.thresholdSol.toFixed(3) + ' SOL raised · ' + pct + '%' +
      (pool.migrated ? ' · moved to its DEX pool' : pool.curveFull ? ' · curve full' : '');
    $('t-buy').disabled = busy || pool.curveFull;
  }

  async function load(address) {
    fail('');
    say('');
    pool = null;
    renderInfo();
    const a = String(address || '').trim();
    if (!L.isMint(a)) { fail(WHY.bad_pool); return false; }
    try {
      const res = await fetch('/api/launch/pool?address=' + encodeURIComponent(a), { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) { fail(WHY[body && body.error] || 'Could not load that pool. Try again.'); return false; }
      pool = body;
      renderInfo();
      return true;
    } catch (err) {
      fail('Could not load that pool. Try again.');
      return false;
    }
  }

  async function buy() {
    if (!pool || busy) return;
    const sol = Number($('t-amt').value);
    if (!Number.isFinite(sol) || sol < 0.01 || sol > 5) { fail(WHY.bad_amount); return; }
    fail('');
    busy = true; renderInfo();
    try {
      say('Connecting your wallet…');
      const buyer = W.address || await W.connect();
      say('Preparing the buy…');
      const res = await fetch('/api/launch/buy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool: pool.address, buyer: buyer, sol: sol })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.transaction !== 'string') {
        say('', false);
        fail(WHY[data && data.error] || 'Could not prepare the buy. Try again.');
        busy = false;
        if (data && (data.error === 'curve_full' || data.error === 'migrated')) await load(pool.address);
        renderInfo();
        return;
      }
      say('Approve the buy in your wallet…');
      const signature = await W.signAndSend(data.transaction);
      say('Sent. Waiting for devnet to confirm…');
      const state = await W.confirm(signature);
      if (state === 'confirmed') {
        say('Bought ✓ ' + sol + ' SOL on the curve.' + (data.partialFill ? ' This buy filled the curve, so only part of it was used.' : ''));
        await load(pool.address);
        say('Bought ✓ ' + sol + ' SOL on the curve.' + (data.partialFill ? ' This buy filled the curve, so only part of it was used.' : ''));
      } else if (state === 'failed') {
        say('', false);
        fail('The buy failed on-chain. The curve may have changed. Reload the pool and try again.');
      } else {
        say('Not confirmed yet. Reload the pool in a minute to see the result.', true);
      }
    } catch (err) {
      const m = err && err.message ? String(err.message) : '';
      if (err && err.code === 'no_wallet') { say('', false); fail(W.NO_WALLET); }
      else if (/reject|denied|cancel/i.test(m)) say('You declined the transaction.', true);
      else { say('', false); fail('The buy did not go through. Check that your wallet is on Devnet and has test SOL.'); }
    }
    busy = false; renderInfo();
  }

  $('t-load').addEventListener('click', () => { load($('t-pool').value); });
  $('t-pool').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); load($('t-pool').value); } });
  $('t-buy').addEventListener('click', buy);

  // A launch made on this page opens the card with its pool loaded.
  document.addEventListener('draftpad:launched', e => {
    $('t-pool').value = e.detail.pool;
    $('trade').open = true;
    load(e.detail.pool);
  });

  // The card only shows when launching is switched on for this site.
  $('trade').hidden = true;
  fetch('/api/launch/config', { headers: { Accept: 'application/json' } })
    .then(r => r.json())
    .then(info => { $('trade').hidden = !(info && info.enabled); })
    .catch(() => { $('trade').hidden = true; });
})();
