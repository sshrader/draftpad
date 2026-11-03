'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/logic.js');
const { SAMPLE } = require('../public/sample.js');

const FILTERS = { minLiq: 25000, minAge: 6, maxTop10: 45, maxBundled: 20, needRevoked: true };

// Totals and statuses recorded before the refactor to windows, so scoring drift shows up here.
const GOLDEN = {
  HERON: [91, 'pass'], MOTH: [58, 'pass'], WLRS: [85, 'watch'], PCMT: [53, 'pass'], PRTZL: [81, 'fail'],
  FRRT: [75, 'pass'], KITE: [48, 'pass'], HPGN: [69, 'watch'], DSCO: [42, 'pass'], OTTR: [39, 'watch'],
  HALO: [66, 'fail'], MLDV: [70, 'fail'], PORCA: [64, 'fail'], VBLT: [42, 'pass'], GLSB: [44, 'watch']
};

test('sample tokens score and screen the same as before', () => {
  assert.equal(SAMPLE.length, 15);
  for (const t of SAMPLE) {
    const [total, status] = GOLDEN[t.sym];
    assert.equal(L.computeScore(t).total, total, t.sym + ' score');
    assert.equal(L.evaluate(t, FILTERS).status, status, t.sym + ' status');
  }
});

test('sample windows add up to the 24h volume', () => {
  for (const t of SAMPLE) {
    assert.ok(Math.abs(t.win.h24 - t.vol24) / t.vol24 < 1e-9, t.sym);
  }
});

test('momentum compares the last 6 hours with the 18 before and caps at 99', () => {
  assert.equal(L.momentum({ h1: 0, h6: 300, h24: 600 }), 3);
  assert.equal(L.momentum({ h6: 100, h24: 100 }), 99);
  assert.equal(L.momentum({ h6: 0, h24: 0 }), null);
  assert.equal(L.momentum(null), null);
  assert.equal(L.momentum({ h24: 500 }), null);
});

test('missing signals are left out and the total is scaled over the rest', () => {
  const t = { buyers: 5000, top10: 20, bundled: null, win: { h6: 300, h24: 600 } };
  const sc = L.computeScore(t);
  assert.equal(sc.parts.clean, null);
  assert.equal(sc.coverage, 85);
  assert.equal(sc.total, 100);
  const empty = L.computeScore({ buyers: null, top10: null, bundled: null, win: null });
  assert.equal(empty.total, 0);
  assert.equal(empty.coverage, 0);
});

test('unknown authorities fail when revoked is required and only warn otherwise', () => {
  const base = { liq: 100000, ageH: 48, top10: 20, bundled: 5, mintRevoked: null, freezeRevoked: true };
  assert.equal(L.evaluate(base, FILTERS).status, 'fail');
  assert.equal(L.evaluate(base, Object.assign({}, FILTERS, { needRevoked: false })).status, 'watch');
});

test('missing holder data warns, and missing bundle data is ignored', () => {
  const t = { liq: 100000, ageH: 48, top10: null, bundled: null, mintRevoked: true, freezeRevoked: true };
  const ev = L.evaluate(t, FILTERS);
  assert.equal(ev.checks.find(c => c.label === 'Top holders').status, 'watch');
  assert.equal(ev.checks.find(c => c.label === 'Bundled buys').status, 'na');
  assert.equal(ev.status, 'watch');
  const ok = Object.assign({}, t, { top10: 20 });
  assert.equal(L.evaluate(ok, FILTERS).status, 'pass');
});

test('audit flag and dev balance checks', () => {
  const ok = { liq: 100000, ageH: 48, top10: 20, bundled: 5, mintRevoked: true, freezeRevoked: true };
  assert.equal(L.evaluate(Object.assign({}, ok, { sus: true }), FILTERS).status, 'fail');
  assert.equal(L.evaluate(Object.assign({}, ok, { sus: false }), FILTERS).status, 'pass');
  assert.equal(L.evaluate(Object.assign({}, ok, { devPct: 12 }), FILTERS).status, 'watch');
  assert.equal(L.evaluate(Object.assign({}, ok, { devPct: 30 }), FILTERS).status, 'fail');
});

test('tooClose catches names and tickers that read as the original', () => {
  assert.equal(L.tooClose('Static Heron', 'Static Heron', false), true);
  assert.equal(L.tooClose('Static Herons', 'Static Heron', false), true);
  assert.equal(L.tooClose('Salt Lantern', 'Static Heron', false), false);
  assert.equal(L.tooClose('HERON', 'HERON', true), true);
  assert.equal(L.tooClose('HRON', 'HERON', true), true);
  assert.equal(L.tooClose('LNTRN', 'HERON', true), false);
  assert.equal(L.tooClose('', 'HERON', true), false);
});

test('esc escapes markup characters', () => {
  assert.equal(L.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('formatting helpers', () => {
  assert.equal(L.money(2900000), '$2.9M');
  assert.equal(L.money(184000), '$184K');
  assert.equal(L.money(28000), '$28K');
  assert.equal(L.money(880000), '$880K');
  assert.equal(L.money(950), '$950');
  assert.equal(L.count(4210), '4.2K');
  assert.equal(L.count(980), '980');
  assert.equal(L.pct(22.46), '22.5%');
  assert.equal(L.ageLabel(31.2), '31h');
  assert.equal(L.ageLabel(96), '4d');
  assert.equal(L.ageLabel(null), 'n/a');
});
