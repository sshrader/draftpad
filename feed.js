'use strict';

// Live trending feed. Pulls Jupiter's Tokens API v2 on the server, keeps the API key
// out of the browser, caches the result, and normalizes each token into the shape the
// page uses. Fields the API does not provide are left null and the page shows "no data".

const CATEGORIES = ['toptrending', 'toptraded'];
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

// Token names and symbols are untrusted text from the market. Strip control characters
// (Cc), invisible format characters such as zero-width spaces and bidirectional overrides
// (Cf), and line or paragraph separators (Zl, Zp). These can be used to spoof what a name
// looks like.
function clean(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, max);
}

function sumVolume(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const buy = num(stats.buyVolume);
  const sell = num(stats.sellVolume);
  return buy === null || sell === null ? null : buy + sell;
}

function normalizeToken(raw, nowMs) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && MINT_RE.test(raw.id) ? raw.id : null;
  const sym = clean(raw.symbol, 12);
  const name = clean(raw.name, 40);
  if (!id || !sym || !name) return null;

  const stats24 = raw.stats24h && typeof raw.stats24h === 'object' ? raw.stats24h : null;
  const liq = num(raw.liquidity);
  const vol24 = sumVolume(stats24);
  if (!stats24 || liq === null || vol24 === null) return null;

  const created = Date.parse(raw.firstPool && raw.firstPool.createdAt) || Date.parse(raw.createdAt);
  const ageH = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 3600000) : null;

  const audit = raw.audit && typeof raw.audit === 'object' ? raw.audit : null;
  const flag = key => (audit && typeof audit[key] === 'boolean') ? audit[key] : null;

  return {
    id,
    name,
    sym,
    ageH,
    liq,
    vol24,
    chg: num(stats24.priceChange),
    buyers: num(stats24.numOrganicBuyers),
    holders: num(raw.holderCount),
    top10: audit ? num(audit.topHoldersPercentage) : null,
    bundled: null,
    mintRevoked: flag('mintAuthorityDisabled'),
    freezeRevoked: flag('freezeAuthorityDisabled'),
    sus: audit ? audit.isSus === true : null,
    devPct: audit ? num(audit.devBalancePercentage) : null,
    win: { h1: sumVolume(raw.stats1h), h6: sumVolume(raw.stats6h), h24: vol24 }
  };
}

function createFeed(opts) {
  const o = opts || {};
  const apiKey = o.apiKey || '';
  const base = (o.base || 'https://api.jup.ag').replace(/\/+$/, '');
  const ttlMs = o.ttlMs || 300000;
  const timeoutMs = o.timeoutMs || 10000;
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const now = o.now || Date.now;
  const logger = o.logger || console;

  const cache = new Map();
  const inflight = new Map();
  let loggedShape = false;

  async function fetchCategory(category) {
    const res = await fetchImpl(base + '/tokens/v2/' + category + '/24h?limit=50', {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const err = new Error('upstream_' + res.status);
      err.code = 'upstream_' + res.status;
      throw err;
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) {
      const err = new Error('unexpected_shape');
      err.code = 'unexpected_shape';
      throw err;
    }
    if (!loggedShape && raw.length) {
      loggedShape = true;
      logger.log('Jupiter token fields: ' + Object.keys(raw[0]).join(','));
    }
    const t = now();
    const tokens = raw.map(r => normalizeToken(r, t)).filter(Boolean);
    if (raw.length && !tokens.length) logger.error('Jupiter returned ' + raw.length + ' tokens but none matched the expected shape');
    return { source: 'jupiter', category, fetchedAt: new Date(t).toISOString(), received: raw.length, kept: tokens.length, tokens };
  }

  async function get(category) {
    if (!apiKey) return { status: 503, body: { error: 'not_configured' } };
    const cached = cache.get(category);
    if (cached && now() - cached.at < ttlMs) return { status: 200, body: cached.payload };

    if (!inflight.has(category)) {
      const p = fetchCategory(category)
        .then(payload => { cache.set(category, { at: now(), payload }); return payload; })
        .finally(() => inflight.delete(category));
      inflight.set(category, p);
    }
    try {
      return { status: 200, body: await inflight.get(category) };
    } catch (err) {
      logger.error('Jupiter fetch failed: ' + (err && err.message ? err.message : 'unknown error'));
      if (cached) return { status: 200, body: Object.assign({}, cached.payload, { stale: true }) };
      return { status: 503, body: { error: 'feed_unavailable', detail: (err && err.code) || 'error' } };
    }
  }

  return { get, configured: Boolean(apiKey) };
}

module.exports = { createFeed, normalizeToken, CATEGORIES };
