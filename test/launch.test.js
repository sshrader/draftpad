'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLauncher, loadPresets, metadataFor } = require('../launch.js');
const { createApp } = require('../server.js');

const CONFIG = 'CAAYwzGN4XjofFLZt4iwhMw9L8pH9BY379YjLUo3Qq8o';
const CREATOR = 'CFyapVaq8njp4N6Qqrw7XETB89GuLkLwHH6huUtcY4Ws';
const PRESETS = { network: 'devnet', presets: { standard: { config: CONFIG, totalPct: 1, creatorSharePct: 40 } } };
const quiet = { log() {}, error() {} };

// Stand-ins for the Meteora SDK and web3.js, so these tests need neither installed.
function fakeLoad(calls) {
  class PublicKey { constructor(v) { this.v = v; } toBase58() { return this.v; } }
  const web3 = {
    PublicKey,
    Keypair: { generate: () => ({ publicKey: new PublicKey('MintKeyPair1111111111111111111111111111111') }) },
    Connection: class { async getLatestBlockhash() { return { blockhash: 'BLOCKHASH' }; } }
  };
  const sdk = {
    DynamicBondingCurveClient: class {
      constructor() {
        this.creator = {
          createPool: async params => {
            calls.push(params);
            return { partialSign(k) { this.signedBy = k.publicKey.toBase58(); }, serialize() { return Buffer.from('TX-BYTES'); } };
          }
        };
      }
    },
    deriveDbcPoolAddress: () => new PublicKey('PoolAddress11111111111111111111111111111111')
  };
  return async () => ({ sdk, web3, spl: { NATIVE_MINT: new PublicKey('So11111111111111111111111111111111111111112') } });
}

const ctx = { ip: '1.2.3.4', baseUrl: 'https://draftpad.example' };
const good = { preset: 'standard', name: 'Salt Lantern', symbol: '$lntrn', creator: CREATOR };

test('presets file: only devnet files with valid config addresses are accepted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  const write = (n, v) => { const f = path.join(dir, n); fs.writeFileSync(f, JSON.stringify(v)); return f; };
  assert.deepEqual(Object.keys(loadPresets(write('ok.json', PRESETS)).presets), ['standard']);
  assert.equal(loadPresets(write('main.json', Object.assign({}, PRESETS, { network: 'mainnet' }))), null);
  assert.equal(loadPresets(write('bad.json', { network: 'devnet', presets: { x: { config: 'nope' } } })), null);
  assert.equal(loadPresets(path.join(dir, 'missing.json')), null);
});

test('launching refuses to start against a mainnet RPC', () => {
  assert.throws(() => createLauncher({ presets: PRESETS, rpcUrl: 'https://api.mainnet-beta.solana.com' }), /devnet/);
});

test('prepare builds an unsigned transaction signed only by the new mint', async () => {
  const calls = [];
  const l = createLauncher({ presets: PRESETS, load: fakeLoad(calls), logger: quiet });
  const r = await l.prepare(good, ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.transaction, Buffer.from('TX-BYTES').toString('base64'));
  assert.equal(r.body.mint, 'MintKeyPair1111111111111111111111111111111');
  assert.equal(r.body.pool, 'PoolAddress11111111111111111111111111111111');
  assert.equal(r.body.cluster, 'devnet');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Salt Lantern');
  assert.equal(calls[0].symbol, 'LNTRN');
  assert.equal(calls[0].config.toBase58(), CONFIG);
  assert.equal(calls[0].payer.toBase58(), CREATOR);
  assert.equal(calls[0].poolCreator.toBase58(), CREATOR);
  assert.equal(calls[0].uri, 'https://draftpad.example/meta.json?n=Salt%20Lantern&s=LNTRN');
});

test('prepare rejects bad input before touching the network', async () => {
  const calls = [];
  const l = createLauncher({ presets: PRESETS, load: fakeLoad(calls), logger: quiet, maxPerMinute: 1000 });
  const code = async over => (await l.prepare(Object.assign({}, good, over), ctx));
  assert.equal((await code({ preset: 'nope' })).body.error, 'bad_preset');
  assert.equal((await code({ preset: '__proto__' })).body.error, 'bad_preset');
  assert.equal((await code({ name: '' })).body.error, 'bad_name');
  assert.equal((await code({ name: '‮​' })).body.error, 'bad_name');
  assert.equal((await code({ symbol: 'has space' })).body.error, 'bad_symbol');
  assert.equal((await code({ symbol: 'WAYTOOLONGSYMBOL' })).body.error, 'bad_symbol');
  assert.equal((await code({ creator: 'not a key' })).body.error, 'bad_creator');
  assert.equal((await code({ creator: 5 })).body.error, 'bad_creator');
  assert.equal((await l.prepare('nope', ctx)).body.error, 'bad_preset');
  assert.equal((await l.prepare(good, { ip: 'x', baseUrl: '' })).body.error, 'uri_too_long');
  assert.equal((await code({ name: '你'.repeat(32) })).body.error, 'uri_too_long');
  assert.equal(calls.length, 0);
});

test('name text is cleaned of control and bidi characters', async () => {
  const calls = [];
  const l = createLauncher({ presets: PRESETS, load: fakeLoad(calls), logger: quiet });
  await l.prepare(Object.assign({}, good, { name: 'Salt‮  Lan​tern\u0007' }), ctx);
  assert.equal(calls[0].name, 'Salt Lantern');
});

test('prepare is rate limited per address, and failures are generic', async () => {
  const l = createLauncher({ presets: PRESETS, load: fakeLoad([]), logger: quiet, maxPerMinute: 2 });
  assert.equal((await l.prepare(good, ctx)).status, 200);
  assert.equal((await l.prepare(good, ctx)).status, 200);
  assert.equal((await l.prepare(good, ctx)).status, 429);
  assert.equal((await l.prepare(good, { ip: '9.9.9.9', baseUrl: ctx.baseUrl })).status, 200);

  const broken = createLauncher({ presets: PRESETS, logger: quiet, load: async () => { throw new Error('secret stack detail'); } });
  const r = await broken.prepare(good, ctx);
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'prepare_failed' });
});

test('without presets the launcher is off and says so', async () => {
  const l = createLauncher({ presets: null, logger: quiet });
  assert.deepEqual(l.info(), { enabled: false, cluster: 'devnet', presets: [] });
  assert.equal((await l.prepare(good, ctx)).status, 503);
});

test('metadata is built from the link and refuses junk', () => {
  assert.deepEqual(metadataFor('Salt Lantern', 'lntrn').symbol, 'LNTRN');
  assert.equal(metadataFor('', 'X'), null);
  assert.equal(metadataFor('Name', '<script>'), null);
  assert.equal(metadataFor(null, null), null);
  assert.equal(metadataFor('Name', 'OK').image, '');
});

async function withServer(opts, fn) {
  const srv = createApp(opts);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); } finally {
    srv.closeAllConnections();
    await new Promise(r => srv.close(r));
  }
}
const feed = { configured: false, get: async () => ({ status: 503, body: {} }) };

test('server: launch routes work, and POST is allowed nowhere else', async () => {
  const launcher = createLauncher({ presets: PRESETS, load: fakeLoad([]), logger: quiet });
  await withServer({ feed, launcher }, async base => {
    const cfg = await (await fetch(base + '/api/launch/config')).json();
    assert.deepEqual(cfg, { enabled: true, cluster: 'devnet', presets: ['standard'] });

    const post = body => fetch(base + '/api/launch/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const ok = await post(JSON.stringify(good));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const data = await ok.json();
    assert.equal(data.cluster, 'devnet');
    assert.match(data.transaction, /^[A-Za-z0-9+/=]+$/);

    assert.equal((await post('{not json')).status, 400);
    assert.equal((await post('x'.repeat(5000))).status, 400);
    assert.equal((await post(JSON.stringify(Object.assign({}, good, { preset: 'nope' })))).status, 400);

    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/api/trending', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/api/launch/prepare')).status, 404);
  });
});

test('server: launching is off without a launcher, and meta.json serves metadata', async () => {
  await withServer({ feed }, async base => {
    assert.equal((await (await fetch(base + '/api/launch/config')).json()).enabled, false);
    const r = await fetch(base + '/api/launch/prepare', { method: 'POST', body: '{}' });
    assert.equal(r.status, 503);
    const m = await fetch(base + '/meta.json?n=Salt%20Lantern&s=LNTRN');
    assert.equal(m.status, 200);
    assert.equal((await m.json()).symbol, 'LNTRN');
    assert.equal((await fetch(base + '/meta.json?n=x&s=%3Cb%3E')).status, 400);
  });
});
