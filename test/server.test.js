'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.js');

async function withServer(feed, fn) {
  const srv = createApp({ feed });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    await fn(base);
  } finally {
    srv.closeAllConnections();
    await new Promise(r => srv.close(r));
  }
}

const fakeFeed = {
  configured: true,
  async get(category) {
    return { status: 200, body: { source: 'test', category, tokens: [] } };
  }
};

test('healthz reports whether the live feed is configured', async () => {
  await withServer({ configured: false, get: async () => ({ status: 503, body: {} }) }, async base => {
    const res = await fetch(base + '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, liveFeed: false });
  });
  await withServer(fakeFeed, async base => {
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true, liveFeed: true });
  });
});

test('/api/trending passes the category through and sets cache headers', async () => {
  await withServer(fakeFeed, async base => {
    const res = await fetch(base + '/api/trending?category=toptraded');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).category, 'toptraded');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
    const def = await (await fetch(base + '/api/trending')).json();
    assert.equal(def.category, 'toptrending');
  });
});

test('/api/trending rejects unknown categories and does not cache errors', async () => {
  await withServer(fakeFeed, async base => {
    assert.equal((await fetch(base + '/api/trending?category=../../etc')).status, 400);
  });
  const failing = { configured: true, get: async () => ({ status: 503, body: { error: 'feed_unavailable' } }) };
  await withServer(failing, async base => {
    const res = await fetch(base + '/api/trending');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('serves the page and scripts, and nothing outside public/', async () => {
  await withServer(fakeFeed, async base => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<title>Draftpad<\/title>/);

    const logic = await fetch(base + '/logic.js');
    assert.equal(logic.status, 200);
    assert.match(logic.headers.get('content-type'), /javascript/);

    assert.equal((await fetch(base + '/feed.js')).status, 404);
    assert.equal((await fetch(base + '/server.js')).status, 404);
    assert.equal((await fetch(base + '/%00')).status, 400);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  });
});
