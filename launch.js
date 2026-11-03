'use strict';

// Devnet launch flow, server side. The server builds an UNSIGNED token-launch transaction for the
// creator's wallet to sign. It holds no keys: the only secret it generates is the new token's mint
// keypair, which signs once here and is then discarded. Fee presets come from devnet/presets.json,
// which lists one on-chain config per preset. Mainnet is refused on purpose until a security review.
//
// The Meteora SDK is loaded only when someone launches, so a problem with it can never stop the
// website from starting.

const fs = require('fs');

const SYMBOL_RE = /^[A-Za-z0-9]{1,10}$/;
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_URI = 200; // the on-chain metadata URI limit

// Same character stripping as the feed: control, invisible format, and line separator characters.
function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function loadPresets(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!j || j.network !== 'devnet' || !j.presets || typeof j.presets !== 'object') return null;
    const ok = {};
    for (const id of Object.keys(j.presets)) {
      const p = j.presets[id];
      if (p && typeof p.config === 'string' && B58_RE.test(p.config)) ok[id] = { config: p.config, totalPct: p.totalPct, creatorSharePct: p.creatorSharePct };
    }
    return Object.keys(ok).length ? { network: 'devnet', presets: ok } : null;
  } catch (err) {
    return null;
  }
}

async function loadReal() {
  const [sdk, web3, spl] = await Promise.all([
    import('@meteora-ag/dynamic-bonding-curve-sdk'),
    import('@solana/web3.js'),
    import('@solana/spl-token')
  ]);
  return { sdk, web3, spl };
}

// Small in-memory limiter: each launch preparation makes an RPC call.
function createLimiter(max, windowMs, now) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);
    return true;
  };
}

function createLauncher(opts) {
  const o = opts || {};
  const presets = o.presets === undefined ? loadPresets(o.presetsFile) : o.presets;
  const rpcUrl = o.rpcUrl || 'https://api.devnet.solana.com';
  const load = o.load || loadReal;
  const logger = o.logger || console;
  const allow = createLimiter(o.maxPerMinute || 10, 60000, o.now || Date.now);

  if (/mainnet/i.test(rpcUrl)) throw new Error('Launch RPC looks like mainnet. This build only supports devnet.');

  function info() {
    return { enabled: Boolean(presets), cluster: 'devnet', presets: presets ? Object.keys(presets.presets) : [] };
  }

  // Returns { status, body }. Never throws.
  async function prepare(input, ctx) {
    if (!presets) return { status: 503, body: { error: 'launch_unavailable' } };
    if (!allow((ctx && ctx.ip) || 'unknown')) return { status: 429, body: { error: 'rate_limited' } };

    const b = input && typeof input === 'object' ? input : {};
    // Own properties only, so names like __proto__ or constructor are not presets.
    const preset = typeof b.preset === 'string' && Object.prototype.hasOwnProperty.call(presets.presets, b.preset) ? presets.presets[b.preset] : null;
    if (!preset) return { status: 400, body: { error: 'bad_preset' } };
    const name = cleanText(b.name, 32);
    if (!name) return { status: 400, body: { error: 'bad_name' } };
    const symbol = typeof b.symbol === 'string' ? b.symbol.replace(/^\$/, '').trim().toUpperCase() : '';
    if (!SYMBOL_RE.test(symbol)) return { status: 400, body: { error: 'bad_symbol' } };
    if (typeof b.creator !== 'string' || !B58_RE.test(b.creator)) return { status: 400, body: { error: 'bad_creator' } };

    const base = String((ctx && ctx.baseUrl) || '').replace(/\/+$/, '');
    const uri = base + '/meta.json?n=' + encodeURIComponent(name) + '&s=' + encodeURIComponent(symbol);
    if (!/^https?:\/\//.test(base) || uri.length > MAX_URI) return { status: 400, body: { error: 'uri_too_long' } };

    try {
      const { sdk, web3, spl } = await load();
      const connection = new web3.Connection(rpcUrl, 'confirmed');
      const dbc = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
      const creatorPk = new web3.PublicKey(b.creator);
      const configPk = new web3.PublicKey(preset.config);
      const baseMint = web3.Keypair.generate();

      // Meteora's docs put createPool under client.creator; older builds used client.pool.
      const svc = dbc.creator && dbc.creator.createPool ? dbc.creator : dbc.pool;
      const tx = await svc.createPool({
        baseMint: baseMint.publicKey, config: configPk, name, symbol, uri,
        payer: creatorPk, poolCreator: creatorPk
      });
      const latest = await connection.getLatestBlockhash('confirmed');
      tx.feePayer = creatorPk;
      tx.recentBlockhash = latest.blockhash;
      tx.partialSign(baseMint);

      const pool = sdk.deriveDbcPoolAddress(spl.NATIVE_MINT, baseMint.publicKey, configPk);
      return {
        status: 200,
        body: {
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
          mint: baseMint.publicKey.toBase58(),
          pool: pool.toBase58(),
          preset: b.preset,
          cluster: 'devnet'
        }
      };
    } catch (err) {
      logger.error('Launch prepare failed: ' + (err && err.message ? err.message : 'unknown error'));
      return { status: 502, body: { error: 'prepare_failed' } };
    }
  }

  return { info, prepare };
}

// Metadata for the token, built from the link itself so nothing needs storing. No image on devnet yet.
function metadataFor(name, symbol) {
  const n = cleanText(name, 32);
  const s = typeof symbol === 'string' ? symbol.replace(/^\$/, '').trim().toUpperCase() : '';
  if (!n || !SYMBOL_RE.test(s)) return null;
  return { name: n, symbol: s, description: 'A devnet test token launched on Draftpad. Not affiliated with any other token.', image: '' };
}

module.exports = { createLauncher, loadPresets, metadataFor, cleanText };
