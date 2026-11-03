/* Fictional sample tokens, shown when the live feed is unavailable.
   Loaded by the page as window.DraftpadSample and by the tests through require(). */
(function () {
  'use strict';
  const L = (typeof module === 'object' && module.exports) ? require('./logic.js') : window.DraftpadLogic;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hourly(t) {
    const r = rng(t.seed);
    const w = [];
    for (let h = 0; h < 24; h++) {
      const x = h / 23;
      let base = 1;
      if (t.shape === 'surge') base = 0.35 + Math.pow(x, 2.4) * 3.2;
      else if (t.shape === 'fade') base = 2.1 - 1.7 * x;
      w.push(Math.max(0.05, base * (0.75 + r() * 0.5)));
    }
    const s = w.reduce((a, b) => a + b, 0);
    return w.map(v => v / s * t.vol24);
  }

  const RAW = [
    { id: 1, name: 'Static Heron', sym: 'HERON', ageH: 31, liq: 184000, vol24: 2900000, chg: 212, buyers: 4210, holders: 6120, top10: 24, bundled: 6, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 11 },
    { id: 2, name: 'Tinfoil Moth', sym: 'MOTH', ageH: 52, liq: 142000, vol24: 1700000, chg: 96, buyers: 3380, holders: 5230, top10: 29, bundled: 9, mintRevoked: true, freezeRevoked: true, shape: 'steady', seed: 23 },
    { id: 3, name: 'Dusk Walrus', sym: 'WLRS', ageH: 19, liq: 96000, vol24: 4400000, chg: 340, buyers: 5120, holders: 3890, top10: 41, bundled: 17, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 37 },
    { id: 4, name: 'Pocket Comet', sym: 'PCMT', ageH: 74, liq: 310000, vol24: 1200000, chg: 41, buyers: 2060, holders: 9810, top10: 18, bundled: 3, mintRevoked: true, freezeRevoked: true, shape: 'steady', seed: 41 },
    { id: 5, name: 'Neon Pretzel', sym: 'PRTZL', ageH: 11, liq: 58000, vol24: 2100000, chg: 480, buyers: 3900, holders: 2700, top10: 36, bundled: 12, mintRevoked: true, freezeRevoked: false, shape: 'surge', seed: 53 },
    { id: 6, name: 'Lunar Ferret', sym: 'FRRT', ageH: 27, liq: 71000, vol24: 1400000, chg: 128, buyers: 2480, holders: 3340, top10: 31, bundled: 8, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 67 },
    { id: 7, name: 'Brass Kite', sym: 'KITE', ageH: 40, liq: 52000, vol24: 880000, chg: 64, buyers: 1720, holders: 2900, top10: 27, bundled: 5, mintRevoked: true, freezeRevoked: true, shape: 'steady', seed: 71 },
    { id: 8, name: 'Hollow Pigeon', sym: 'HPGN', ageH: 22, liq: 39000, vol24: 1100000, chg: 177, buyers: 2230, holders: 2150, top10: 38, bundled: 13, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 83 },
    { id: 9, name: 'Sunken Disco', sym: 'DSCO', ageH: 66, liq: 120000, vol24: 640000, chg: 33, buyers: 1380, holders: 4710, top10: 22, bundled: 4, mintRevoked: true, freezeRevoked: true, shape: 'fade', seed: 97 },
    { id: 10, name: 'Quiet Otter', sym: 'OTTR', ageH: 15, liq: 28000, vol24: 540000, chg: 88, buyers: 1090, holders: 1320, top10: 33, bundled: 10, mintRevoked: true, freezeRevoked: true, shape: 'steady', seed: 101 },
    { id: 11, name: 'Rusty Halo', sym: 'HALO', ageH: 20, liq: 66000, vol24: 2200000, chg: 221, buyers: 3010, holders: 2480, top10: 34, bundled: 38, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 113 },
    { id: 12, name: 'Mild Volcano', sym: 'MLDV', ageH: 3, liq: 47000, vol24: 910000, chg: 610, buyers: 1650, holders: 980, top10: 30, bundled: 7, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 127 },
    { id: 13, name: 'Paper Orca', sym: 'PORCA', ageH: 29, liq: 88000, vol24: 1900000, chg: 142, buyers: 2860, holders: 1900, top10: 63, bundled: 11, mintRevoked: true, freezeRevoked: true, shape: 'surge', seed: 131 },
    { id: 14, name: 'Velvet Bolt', sym: 'VBLT', ageH: 58, liq: 77000, vol24: 730000, chg: 52, buyers: 1540, holders: 3620, top10: 25, bundled: 6, mintRevoked: true, freezeRevoked: true, shape: 'fade', seed: 149 },
    { id: 15, name: 'Glass Badger', sym: 'GLSB', ageH: 36, liq: 44000, vol24: 690000, chg: 47, buyers: 1260, holders: 2410, top10: 28, bundled: 7, mintRevoked: true, freezeRevoked: true, shape: 'steady', seed: 157 }
  ];

  const SAMPLE = RAW.map(t => {
    const series = hourly(t);
    return Object.assign({}, t, { id: 's' + t.id, series, win: L.windowsFromSeries(series) });
  });

  if (typeof module === 'object' && module.exports) module.exports = { SAMPLE };
  else window.DraftpadSample = { SAMPLE };
})();
