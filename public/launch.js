/* Devnet launch, page side. After a launch is staged, this connects the creator's wallet, asks the
   server for an unsigned token-launch transaction, and has the wallet sign and send it. The page
   never sees a private key. Devnet only. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const WEB3_URL = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/lib/index.iife.min.js';
  const L = window.DraftpadLogic;

  let enabled = false;
  let offered = [];
  let staged = null;
  let wallet = null; // base58 address once connected
  let busy = false;

  function provider() {
    const p = window.phantom && window.phantom.solana;
    if (p && p.isPhantom) return p;
    if (window.solana && window.solana.isPhantom) return window.solana;
    return null;
  }

  function say(text, bad) {
    const el = $('dl-status');
    el.textContent = text;
    el.className = 'dl-status' + (bad ? ' bad' : '');
  }

  function loadWeb3() {
    if (window.solanaWeb3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = WEB3_URL;
      s.onload = () => (window.solanaWeb3 ? resolve() : reject(new Error('web3 missing')));
      s.onerror = () => reject(new Error('Could not load the wallet library.'));
      document.head.appendChild(s);
    });
  }

  function render() {
    const show = enabled && staged && offered.indexOf(staged.preset) !== -1;
    $('devnet-launch').hidden = !show;
    if (!show) return;
    $('dl-connect').hidden = Boolean(wallet);
    $('dl-go').hidden = !wallet;
    $('dl-go').disabled = busy;
    $('dl-connect').disabled = busy;
  }

  function showResult(r, signature) {
    const box = $('dl-result');
    box.innerHTML = '';
    const strip = (label, value) => {
      const d = document.createElement('div');
      d.className = 'castrip';
      const l = document.createElement('span'); l.className = 'calab'; l.textContent = label;
      const c = document.createElement('code'); c.className = 'cavalue'; c.textContent = value;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ca-copy'; b.dataset.ca = value; b.textContent = 'Copy';
      b.setAttribute('aria-label', 'Copy ' + label);
      d.appendChild(l); d.appendChild(c); d.appendChild(b);
      return d;
    };
    box.appendChild(strip('MINT', r.mint));
    box.appendChild(strip('POOL', r.pool));
    const links = document.createElement('div');
    [['Transaction', 'https://explorer.solana.com/tx/' + encodeURIComponent(signature) + '?cluster=devnet'],
     ['Token', 'https://explorer.solana.com/address/' + encodeURIComponent(r.mint) + '?cluster=devnet']].forEach((x, i) => {
      const a = document.createElement('a');
      a.href = x[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = x[0] + ' ↗';
      if (i) links.appendChild(document.createTextNode('  '));
      links.appendChild(a);
    });
    box.appendChild(links);
    box.hidden = false;
  }

  async function connect() {
    const p = provider();
    if (!p) {
      say('No Phantom wallet found. Install Phantom, switch it to Devnet (Settings, Developer Settings, Testnet Mode), then reload.', true);
      return;
    }
    busy = true; render();
    try {
      const res = await p.connect();
      wallet = String(res && res.publicKey ? res.publicKey : p.publicKey);
      say('Connected ' + wallet.slice(0, 4) + '…' + wallet.slice(-4) + '. Phantom must be set to Devnet.');
    } catch (err) {
      say('Wallet connection was not approved.', true);
    }
    busy = false; render();
  }

  async function launch() {
    const p = provider();
    if (!p || !wallet || !staged || busy) return;
    busy = true; render();
    $('dl-result').hidden = true;
    try {
      say('Preparing the transaction…');
      const res = await fetch('/api/launch/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: staged.preset, name: staged.name, symbol: staged.symbol, creator: wallet })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.transaction !== 'string') {
        const why = { rate_limited: 'Too many launches. Wait a minute.', bad_name: 'That name is not allowed.', bad_symbol: 'Use 1 to 10 letters or digits for the ticker.', uri_too_long: 'That name is too long.', launch_unavailable: 'Launching is not switched on for this site.' };
        say((data && why[data.error]) || 'Could not prepare the launch. Try again.', true);
        busy = false; render();
        return;
      }
      await loadWeb3();
      const bytes = Uint8Array.from(atob(data.transaction), c => c.charCodeAt(0));
      const tx = window.solanaWeb3.Transaction.from(bytes);
      say('Approve the transaction in your wallet…');
      const sent = await p.signAndSendTransaction(tx);
      const signature = sent && sent.signature ? sent.signature : String(sent);
      say('Sent. Devnet usually confirms within a few seconds.');
      showResult(data, signature);
    } catch (err) {
      const m = err && err.message ? String(err.message) : '';
      say(/reject|denied|cancel/i.test(m) ? 'You declined the transaction.' : 'The launch did not go through. Check that your wallet is on Devnet and has test SOL.', true);
    }
    busy = false; render();
  }

  $('dl-connect').addEventListener('click', connect);
  $('dl-go').addEventListener('click', launch);

  document.addEventListener('draftpad:staged', e => {
    staged = e.detail;
    $('dl-result').hidden = true;
    say('');
    render();
  });

  fetch('/api/launch/config', { headers: { Accept: 'application/json' } })
    .then(r => r.json())
    .then(info => {
      enabled = Boolean(info && info.enabled && L && Array.isArray(info.presets));
      offered = enabled ? info.presets : [];
      render();
    })
    .catch(() => { enabled = false; });
})();
