'use strict';

// Live trending feed. Pulls Jupiter's Tokens API v2 on the server, keeps the API key
// out of the browser, caches the result, and normalizes each token into the shape the
// page uses. Fields the API does not provide are left null and the page shows "no data".
//
// For each time window (1h, 6h, 24h) the candidate pool merges Jupiter's trending list,
// its most-traded list and its newest listings, then drops duplicates. A single ranking
// is mostly established tokens, and the merged pool is what surfaces fresh launches.

const WINDOWS = ['5m', '1h', '6h', '24h'];
const SOURCES = [
  { name: 'toptrending', path: w => '/tokens/v2/toptrending/' + w + '?limit=100' },
  { name: 'toptraded', path: w => '/tokens/v2/toptraded/' + w + '?limit=100' },
  { name: 'recent', path: () => '/tokens/v2/recent?limit=100' }
];
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

// `win` picks which window the headline numbers (volume, price change, buyers) describe.
// The three volume windows in `win` are always filled when the feed has them, because the
// momentum score compares the last 6 hours with the 24.
function normalizeToken(raw, nowMs, win) {
  const w = WINDOWS.indexOf(win) === -1 ? '24h' : win;
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && MINT_RE.test(raw.id) ? raw.id : null;
  const sym = clean(raw.symbol, 12);
  const name = clean(raw.name, 40);
  if (!id || !sym || !name) return null;

  const stats = raw['stats' + w] && typeof raw['stats' + w] === 'object' ? raw['stats' + w] : null;
  const liq = num(raw.liquidity);
  const vol = sumVolume(stats);
  if (!stats || liq === null || vol === null) return null;

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
    vol,
    chg: num(stats.priceChange),
    buyers: num(stats.numOrganicBuyers),
    holders: num(raw.holderCount),
    top10: audit ? num(audit.topHoldersPercentage) : null,
    bundled: null,
    mintRevoked: flag('mintAuthorityDisabled'),
    freezeRevoked: flag('freezeAuthorityDisabled'),
    sus: audit ? audit.isSus === true : null,
    devPct: audit ? num(audit.devBalancePercentage) : null,
    win: { h1: sumVolume(raw.stats1h), h6: sumVolume(raw.stats6h), h24: sumVolume(raw.stats24h) }
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

  async function fetchSource(src, win) {
    const res = await fetchImpl(base + src.path(win), {
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
    return raw;
  }

  async function fetchWindow(win) {
    const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s, win)));
    const good = results.filter(r => r.status === 'fulfilled');
    // One list failing is fine. Nothing at all is an error, reported with the first cause.
    if (!good.length) throw results[0].reason;
    results.forEach((r, i) => {
      if (r.status === 'rejected') logger.error('Jupiter ' + SOURCES[i].name + ' list failed: ' + (r.reason && r.reason.message));
    });

    const t = now();
    const seen = new Set();
    const unique = [];
    for (const r of good) {
      for (const item of r.value) {
        const key = item && typeof item.id === 'string' ? item.id : null;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        unique.push(item);
      }
    }
    const tokens = unique.map(r => normalizeToken(r, t, win)).filter(Boolean);
    if (unique.length && !tokens.length) logger.error('Jupiter returned ' + unique.length + ' tokens but none matched the expected shape');
    return {
      source: 'jupiter', window: win, fetchedAt: new Date(t).toISOString(),
      received: unique.length, kept: tokens.length, lists: good.length, tokens
    };
  }

  async function get(win) {
    if (!apiKey) return { status: 503, body: { error: 'not_configured' } };
    const cached = cache.get(win);
    if (cached && now() - cached.at < ttlMs) return { status: 200, body: cached.payload };

    if (!inflight.has(win)) {
      const p = fetchWindow(win)
        .then(payload => { cache.set(win, { at: now(), payload }); return payload; })
        .finally(() => inflight.delete(win));
      inflight.set(win, p);
    }
    try {
      return { status: 200, body: await inflight.get(win) };
    } catch (err) {
      logger.error('Jupiter fetch failed: ' + (err && err.message ? err.message : 'unknown error'));
      if (cached) return { status: 200, body: Object.assign({}, cached.payload, { stale: true }) };
      return { status: 503, body: { error: 'feed_unavailable', detail: (err && err.code) || 'error' } };
    }
  }

  return { get, configured: Boolean(apiKey) };
}

module.exports = { createFeed, normalizeToken, WINDOWS };
