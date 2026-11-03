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
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const MAX_URI = 200; // the on-chain metadata URI limit
const MIN_BUY_SOL = 0.01;
const MAX_BUY_SOL = 5;

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
  const [sdk, web3, spl, bnMod] = await Promise.all([
    import('@meteora-ag/dynamic-bonding-curve-sdk'),
    import('@solana/web3.js'),
    import('@solana/spl-token'),
    import('bn.js')
  ]);
  return { sdk, web3, spl, BN: bnMod.default || bnMod };
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
  const allowRead = createLimiter(o.maxReadsPerMinute || 120, 60000, o.now || Date.now);
  const presetConfigs = new Map(presets ? Object.keys(presets.presets).map(id => [presets.presets[id].config, id]) : []);

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


  // ---- Reading the chain: whether a transaction landed, and where a curve stands ----

  async function status(sig, ctx) {
    if (!presets) return { status: 503, body: { error: 'launch_unavailable' } };
    if (!allowRead((ctx && ctx.ip) || 'unknown')) return { status: 429, body: { error: 'rate_limited' } };
    if (typeof sig !== 'string' || !SIG_RE.test(sig)) return { status: 400, body: { error: 'bad_signature' } };
    try {
      const { web3 } = await load();
      const connection = new web3.Connection(rpcUrl, 'confirmed');
      const r = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const st = r && r.value && r.value[0];
      if (!st) return { status: 200, body: { state: 'pending' } };
      if (st.err) return { status: 200, body: { state: 'failed' } };
      const done = st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized';
      return { status: 200, body: { state: done ? 'confirmed' : 'pending' } };
    } catch (err) {
      logger.error('Launch status failed: ' + (err && err.message ? err.message : 'unknown error'));
      return { status: 502, body: { error: 'status_failed' } };
    }
  }

  // Loads a pool and checks it was made from one of our preset configs, so this only ever serves Draftpad launches.
  async function readPool(address) {
    const { sdk, web3, spl, BN } = await load();
    const connection = new web3.Connection(rpcUrl, 'confirmed');
    const dbc = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
    const poolPk = new web3.PublicKey(address);
    const ps = await dbc.state.getPool(poolPk);
    if (!ps) return { error: 'pool_not_found' };
    // Different SDK versions nest the pool account differently; accept both.
    const v = ps.config ? ps : ps.poolState;
    const presetId = presetConfigs.get(v.config.toBase58());
    if (!presetId) return { error: 'not_a_draftpad_pool' };
    const cfg = await dbc.state.getPoolConfig(v.config);
    const raised = Number(v.quoteReserve.toString());
    const need = Number(cfg.migrationQuoteThreshold.toString());
    return { sdk, web3, spl, BN, connection, dbc, poolPk, v, cfg, presetId, raised, need };
  }

  async function pool(address, ctx) {
    if (!presets) return { status: 503, body: { error: 'launch_unavailable' } };
    if (!allowRead((ctx && ctx.ip) || 'unknown')) return { status: 429, body: { error: 'rate_limited' } };
    if (typeof address !== 'string' || !B58_RE.test(address)) return { status: 400, body: { error: 'bad_pool' } };
    try {
      const r = await readPool(address);
      if (r.error) return { status: 404, body: { error: r.error } };
      const migrated = Boolean(Number(r.v.isMigrated));
      return {
        status: 200,
        body: {
          address, preset: r.presetId,
          raisedSol: r.raised / 1e9, thresholdSol: r.need / 1e9,
          progress: r.need ? Math.min(1, r.raised / r.need) : 0,
          migrated, curveFull: migrated || (r.need > 0 && r.raised >= r.need), cluster: 'devnet'
        }
      };
    } catch (err) {
      logger.error('Launch pool read failed: ' + (err && err.message ? err.message : 'unknown error'));
      return { status: 502, body: { error: 'pool_read_failed' } };
    }
  }

  // Builds an unsigned buy for the buyer's wallet to sign.
  async function buy(input, ctx) {
    if (!presets) return { status: 503, body: { error: 'launch_unavailable' } };
    if (!allow((ctx && ctx.ip) || 'unknown')) return { status: 429, body: { error: 'rate_limited' } };
    const b = input && typeof input === 'object' ? input : {};
    if (typeof b.pool !== 'string' || !B58_RE.test(b.pool)) return { status: 400, body: { error: 'bad_pool' } };
    if (typeof b.buyer !== 'string' || !B58_RE.test(b.buyer)) return { status: 400, body: { error: 'bad_buyer' } };
    const sol = Number(b.sol);
    if (!Number.isFinite(sol) || sol < MIN_BUY_SOL || sol > MAX_BUY_SOL) return { status: 400, body: { error: 'bad_amount' } };

    try {
      const r = await readPool(b.pool);
      if (r.error) return { status: 404, body: { error: r.error } };
      if (Boolean(Number(r.v.isMigrated))) return { status: 409, body: { error: 'migrated' } };
      if (r.need > 0 && r.raised >= r.need) return { status: 409, body: { error: 'curve_full' } };

      const lamports = Math.floor(sol * 1e9);
      const amountIn = new r.BN(lamports);
      const buyerPk = new r.web3.PublicKey(b.buyer);
      // A buy that would fill the curve must be a partial fill. The SDK's quote for that mode failed in
      // testing, so it is sent with no minimum output. That is acceptable on devnet only, and this build
      // refuses mainnet. Revisit it before any mainnet use.
      const crossing = r.need - r.raised < lamports * 1.2;
      const swapMode = crossing ? r.sdk.SwapMode.PartialFill : r.sdk.SwapMode.ExactIn;
      let minimumAmountOut = new r.BN(0);
      if (!crossing) {
        // The SDK's quote has thrown inside its own code on devnet pools. It only sets a safety minimum,
        // so on devnet a failed quote falls back to no minimum and is logged. Revisit before mainnet.
        try {
          const currentPoint = r.cfg.activationType === r.sdk.ActivationType.Slot
            ? new r.BN(await r.connection.getSlot())
            : new r.BN(Math.floor(Date.now() / 1000));
          const quote = r.dbc.pool.swapQuote2({
            virtualPool: r.v, config: r.cfg, swapBaseForQuote: false, swapMode, amountIn, slippageBps: 300,
            hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint
          });
          minimumAmountOut = quote.minimumAmountOut;
        } catch (qerr) {
          logger.error('Launch buy quote failed, sending with no minimum: ' + (qerr && qerr.stack ? qerr.stack : qerr));
        }
      }
      const tx = await r.dbc.pool.swap2({
        owner: buyerPk, payer: buyerPk, pool: r.poolPk, swapBaseForQuote: false, swapMode, amountIn,
        minimumAmountOut, referralTokenAccount: null
      });
      const latest = await r.connection.getLatestBlockhash('confirmed');
      tx.feePayer = buyerPk;
      tx.recentBlockhash = latest.blockhash;
      return {
        status: 200,
        body: {
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
          partialFill: crossing, cluster: 'devnet'
        }
      };
    } catch (err) {
      logger.error('Launch buy failed: ' + (err && err.stack ? err.stack : 'unknown error'));
      return { status: 502, body: { error: 'prepare_failed' } };
    }
  }

  return { info, prepare, status, pool, buy };
}

// Metadata for the token, built from the link itself so nothing needs storing. No image on devnet yet.
function metadataFor(name, symbol) {
  const n = cleanText(name, 32);
  const s = typeof symbol === 'string' ? symbol.replace(/^\$/, '').trim().toUpperCase() : '';
  if (!n || !SYMBOL_RE.test(s)) return null;
  return { name: n, symbol: s, description: 'A devnet test token launched on Draftpad. Not affiliated with any other token.', image: '' };
}

module.exports = { createLauncher, loadPresets, metadataFor, cleanText };
