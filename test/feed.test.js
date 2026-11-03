'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createFeed, normalizeToken, WINDOWS } = require('../feed.js');

const MINT = 'So11111111111111111111111111111111111111112';
const NOW = Date.parse('2026-11-03T12:00:00Z');
const quiet = { log() {}, error() {} };

function rawToken(over) {
  return Object.assign({
    id: MINT,
    name: 'Example Token',
    symbol: 'EXT',
    liquidity: 150000,
    holderCount: 4200,
    createdAt: '2026-10-01T00:00:00Z',
    firstPool: { id: 'pool', createdAt: '2026-11-02T06:00:00Z' },
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 22.5, devBalancePercentage: 1.2 },
    stats1h: { buyVolume: 30000, sellVolume: 20000 },
    stats6h: { buyVolume: 200000, sellVolume: 100000 },
    stats24h: { priceChange: 140.2, buyVolume: 900000, sellVolume: 600000, numOrganicBuyers: 2100, numTraders: 5000 }
  }, over);
}

function okResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

test('normalizeToken maps the fields the page uses', () => {
  const t = normalizeToken(rawToken(), NOW);
  assert.deepEqual(t, {
    id: MINT, name: 'Example Token', sym: 'EXT', ageH: 30, liq: 150000, vol: 1500000, chg: 140.2,
    buyers: 2100, holders: 4200, top10: 22.5, bundled: null, mintRevoked: true, freezeRevoked: true,
    sus: false, devPct: 1.2, win: { h1: 50000, h6: 300000, h24: 1500000 }
  });
});

test('normalizeToken reads headline numbers from the chosen window and keeps all three volumes', () => {
  const raw = rawToken({ stats1h: { buyVolume: 6000, sellVolume: 4000, priceChange: 12.5, numOrganicBuyers: 70 } });
  const t = normalizeToken(raw, NOW, '1h');
  assert.equal(t.vol, 10000);
  assert.equal(t.chg, 12.5);
  assert.equal(t.buyers, 70);
  assert.deepEqual(t.win, { h1: 10000, h6: 300000, h24: 1500000 });
  assert.equal(normalizeToken(raw, NOW, 'bogus').vol, 1500000);
  assert.equal(normalizeToken(rawToken({ stats1h: undefined }), NOW, '1h'), null);
});

test('normalizeToken can read the 5 minute window', () => {
  const t = normalizeToken(rawToken({ stats5m: { buyVolume: 700, sellVolume: 300, priceChange: 4, numOrganicBuyers: 9 } }), NOW, '5m');
  assert.equal(t.vol, 1000);
  assert.equal(t.buyers, 9);
  assert.equal(normalizeToken(rawToken(), NOW, '5m'), null);
});

test('normalizeToken falls back to the token creation time when there is no pool time', () => {
  const t = normalizeToken(rawToken({ firstPool: null }), NOW);
  assert.equal(Math.round(t.ageH), 33 * 24 + 12);
});

test('normalizeToken marks audit fields unknown when the audit is missing', () => {
  const t = normalizeToken(rawToken({ audit: null }), NOW);
  assert.equal(t.mintRevoked, null);
  assert.equal(t.freezeRevoked, null);
  assert.equal(t.top10, null);
  assert.equal(t.sus, null);
  assert.equal(t.devPct, null);
});

test('normalizeToken flags suspicious tokens and keeps missing windows null', () => {
  const t = normalizeToken(rawToken({ audit: { isSus: true, mintAuthorityDisabled: false }, stats1h: undefined }), NOW);
  assert.equal(t.sus, true);
  assert.equal(t.mintRevoked, false);
  assert.equal(t.freezeRevoked, null);
  assert.equal(t.win.h1, null);
});

test('normalizeToken drops tokens it cannot use', () => {
  assert.equal(normalizeToken(null, NOW), null);
  assert.equal(normalizeToken(rawToken({ id: 'not a mint' }), NOW), null);
  assert.equal(normalizeToken(rawToken({ symbol: '' }), NOW), null);
  assert.equal(normalizeToken(rawToken({ liquidity: undefined }), NOW), null);
  assert.equal(normalizeToken(rawToken({ stats24h: { priceChange: 1 } }), NOW), null);
  assert.equal(normalizeToken(rawToken({ stats24h: undefined }), NOW), null);
});

test('normalizeToken strips control and bidi characters and caps lengths', () => {
  const t = normalizeToken(rawToken({ name: 'Safe‮Name\u0007' + 'x'.repeat(80), symbol: 'A​B' }), NOW);
  assert.ok(!/[‮\u0007]/.test(t.name));
  assert.equal(t.name.length, 40);
  assert.equal(t.sym, 'AB');
});

test('feed without an API key is not configured', async () => {
  const feed = createFeed({ apiKey: '', logger: quiet });
  assert.equal(feed.configured, false);
  assert.deepEqual(await feed.get('24h'), { status: 503, body: { error: 'not_configured' } });
});

test('feed merges trending, traded and recent lists, drops duplicates, and never leaks the key', async () => {
  const seen = [];
  const other = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const feed = createFeed({
    apiKey: 'secret-key', now: () => NOW, logger: quiet,
    fetchImpl: async (url, init) => {
      seen.push({ url, key: init.headers['x-api-key'] });
      if (url.includes('/toptrending/')) return okResponse([rawToken()]);
      if (url.includes('/toptraded/')) return okResponse([rawToken(), rawToken({ id: other, name: 'Other', symbol: 'OTH' })]);
      return okResponse([rawToken({ id: 'not a mint' })]);
    }
  });
  const r = await feed.get('6h');
  assert.deepEqual(seen.map(x => x.url).sort(), [
    'https://api.jup.ag/tokens/v2/recent?limit=100',
    'https://api.jup.ag/tokens/v2/toptraded/6h?limit=100',
    'https://api.jup.ag/tokens/v2/toptrending/6h?limit=100'
  ]);
  assert.ok(seen.every(x => x.key === 'secret-key'));
  assert.equal(r.status, 200);
  assert.equal(r.body.window, '6h');
  assert.equal(r.body.received, 3);
  assert.equal(r.body.kept, 2);
  assert.equal(r.body.lists, 3);
  assert.deepEqual(r.body.tokens.map(t => t.sym), ['EXT', 'OTH']);
  assert.equal(r.body.fetchedAt, new Date(NOW).toISOString());
  assert.ok(!JSON.stringify(r).includes('secret-key'));
});

test('one failing list does not sink the others, but all failing is an error', async () => {
  const partial = createFeed({
    apiKey: 'k', now: () => NOW, logger: quiet,
    fetchImpl: async url => (url.includes('/recent') ? { ok: false, status: 500 } : okResponse([rawToken()]))
  });
  const r = await partial.get('24h');
  assert.equal(r.status, 200);
  assert.equal(r.body.lists, 2);
  assert.equal(r.body.kept, 1);
});

test('feed serves from cache inside the TTL and refetches after it', async () => {
  let calls = 0;
  let t = NOW;
  const feed = createFeed({
    apiKey: 'k', ttlMs: 1000, now: () => t, logger: quiet,
    fetchImpl: async () => { calls++; return okResponse([rawToken()]); }
  });
  await feed.get('24h');
  t += 500;
  await feed.get('24h');
  assert.equal(calls, 3); // one fetch is three lists
  t += 600;
  await feed.get('24h');
  assert.equal(calls, 6);
  await feed.get('1h'); // each window has its own cache entry
  assert.equal(calls, 9);
});

test('concurrent requests share one upstream fetch', async () => {
  let calls = 0;
  const feed = createFeed({
    apiKey: 'k', now: () => NOW, logger: quiet,
    fetchImpl: async () => { calls++; await new Promise(r => setTimeout(r, 20)); return okResponse([rawToken()]); }
  });
  const results = await Promise.all([feed.get('24h'), feed.get('24h'), feed.get('24h')]);
  assert.equal(calls, 3);
  assert.ok(results.every(r => r.status === 200));
});

test('feed serves stale data when a refresh fails', async () => {
  let t = NOW;
  let fail = false;
  const feed = createFeed({
    apiKey: 'k', ttlMs: 1000, now: () => t, logger: quiet,
    fetchImpl: async () => { if (fail) throw new Error('boom'); return okResponse([rawToken()]); }
  });
  await feed.get('24h');
  t += 5000;
  fail = true;
  const r = await feed.get('24h');
  assert.equal(r.status, 200);
  assert.equal(r.body.stale, true);
  assert.equal(r.body.tokens.length, 1);
});

test('feed reports an error when there is nothing cached', async () => {
  const bad = createFeed({ apiKey: 'k', logger: quiet, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual(await bad.get('24h'), { status: 503, body: { error: 'feed_unavailable', detail: 'upstream_401' } });

  const odd = createFeed({ apiKey: 'k', logger: quiet, fetchImpl: async () => okResponse({ nope: true }) });
  assert.deepEqual(await odd.get('24h'), { status: 503, body: { error: 'feed_unavailable', detail: 'unexpected_shape' } });

  const down = createFeed({ apiKey: 'k', logger: quiet, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await down.get('24h')).body.error, 'feed_unavailable');
});

test('end to end against a local mock of the Jupiter API', async () => {
  const seenPaths = [];
  let seenKey;
  const upstream = http.createServer((req, res) => {
    seenPaths.push(req.url);
    seenKey = req.headers['x-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([rawToken(), rawToken({ id: 'bad' })]));
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  try {
    const feed = createFeed({ apiKey: 'abc', base: 'http://127.0.0.1:' + upstream.address().port + '/', now: () => NOW, logger: quiet });
    const r = await feed.get('24h');
    assert.ok(seenPaths.includes('/tokens/v2/toptrending/24h?limit=100'));
    assert.ok(seenPaths.includes('/tokens/v2/recent?limit=100'));
    assert.equal(seenKey, 'abc');
    assert.equal(r.body.received, 2);
    assert.equal(r.body.kept, 1);
    assert.equal(r.body.tokens[0].sym, 'EXT');
  } finally {
    upstream.closeAllConnections();
    await new Promise(r => upstream.close(r));
  }
});

test('windows are whitelisted', () => {
  assert.deepEqual(WINDOWS, ['5m', '1h', '6h', '24h']);
});
