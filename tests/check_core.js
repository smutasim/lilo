// Checks on src/core.js, the code the page runs. Exits non-zero on failure.
//   1. Ephemeris interpolation vs direct SPICE (tests/ephem_truth.json, off-grid epochs)
//   2. Apollo 11 / 17 landing sun elevation (astronomy-engine fallback: 1969 and 1972 are outside the SPICE span)
//   3. Sub-Earth libration extremes and south-pole sun elevation range over 2027 (SPICE path)
//   4. Event times: 10-min bracket + bisection vs 1-minute brute force (sunrise/sunset and Earth-link edges)
//   5. Finite disk, grid decoding, Pareto sort
//   6. DEM-error clone horizons decode and stay close to the nominal masks
const fs = require('fs'), path = require('path');
const A = require('astronomy-engine');
const L = require('../src/core.js');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const eph = rd('data/ephem.json'), truth = rd('tests/ephem_truth.json'), terrain = rd('data/terrain.json'), sites = rd('data/sites.json').sites;
L.init(eph, A);
let fails = 0; const rows = [];
function check(name, value, ok, target) { rows.push({ name, value, target, pass: !!ok }); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ': ' + value + '  (target ' + target + ')'); }
const ang = (a, b) => Math.acos(Math.min(1, (a[0]*b[0] + a[1]*b[1] + a[2]*b[2]) / Math.hypot(...a) / Math.hypot(...b))) * L.R2D;

// 1
let w = 0, wd = 0;
for (const s of truth.samples) { const d = L.dirs(s.ms); w = Math.max(w, ang(d.sun, s.sun), ang(d.earth, s.earth)); wd = Math.max(wd, Math.abs(Math.hypot(...d.earth) - Math.hypot(...s.earth))); }
check('interpolated ephemeris vs direct SPICE, ' + truth.samples.length + ' off-grid epochs', w.toExponential(1) + ' deg, Earth range ' + wd.toFixed(3) + ' km', w < 1e-4, '< 1e-4 deg');

// 2
const a11 = L.look(L.makeSite(0.67416, 23.47314, 0), Date.UTC(1969, 6, 20, 20, 17, 40));
check('Apollo 11 landing sun elevation (' + a11.src + ')', a11.sunEl.toFixed(2) + ' deg', Math.abs(a11.sunEl - 10.8) < 0.3, '10.8 +- 0.3 deg');
const a17 = L.look(L.makeSite(20.1911, 30.7723, 0), Date.UTC(1972, 11, 11, 19, 54, 57));
check('Apollo 17 landing sun elevation (' + a17.src + ')', a17.sunEl.toFixed(2) + ' deg', Math.abs(a17.sunEl - 13.0) < 1, '~13 deg');

// 3
let mLon = 0, mLat = 0, pmin = 99, pmax = -99; const pole = L.makeSite(-90, 0, 0);
for (let h = 0; h < 24 * 365; h += 2) {
  const ms = Date.UTC(2027, 0, 1) + h * 3600e3, d = L.dirs(ms), r = Math.hypot(...d.earth);
  mLat = Math.max(mLat, Math.abs(Math.asin(d.earth[2] / r) * L.R2D)); mLon = Math.max(mLon, Math.abs(Math.atan2(d.earth[1], d.earth[0]) * L.R2D));
  const e = L.topo(pole, d.sun).el; pmin = Math.min(pmin, e); pmax = Math.max(pmax, e);
}
check('2027 sub-Earth libration extremes', '|lon| ' + mLon.toFixed(2) + ', |lat| ' + mLat.toFixed(2) + ' deg', mLon > 7 && mLon < 8.2 && mLat > 6.4 && mLat < 7, '~7.9 / ~6.9 deg');
check('2027 sun elevation range at the south pole (sphere)', pmin.toFixed(2) + ' .. ' + pmax.toFixed(2) + ' deg', pmax > 1.4 && pmax < 1.7 && pmin < -1.4 && pmin > -1.7, '+-~1.6 deg');

// 4
function siteOf(id, hobs) {
  const s = sites.find(x => x.id === id), t = terrain.sites[id];
  return t ? L.makeSite(s.lat, s.lon, t.h_m + hobs, L.b64i16(t.mask[String(hobs)]), hobs) : L.makeSite(s.lat, s.lon, hobs, null, hobs);
}
const T0 = Date.UTC(2026, 10, 14), T1 = T0 + 60 * 86400e3;
let worstMin = 0, nEv = 0, missed = 0;
for (const id of ['ridge', 'shackleton', 'malapert', 'im2', 'a11']) {
  const s = siteOf(id, 2);
  for (const [nm, pred] of [['sun', ms => L.sunFracAt(s, ms) > 0], ['earth', ms => L.earthMarginAt(s, ms) >= 5]]) {
    const fast = L.findEdges(pred, T0, T1, 600e3, 1000), brute = [];
    let prev = pred(T0);
    for (let t = T0 + 60e3; t <= T1; t += 60e3) { const c = pred(t); if (c !== prev) { brute.push(t - 30e3); prev = c; } }
    // an event pair shorter than the 10-min bracket cannot be seen by the fast search; count those separately
    if (fast.length !== brute.length) missed += Math.abs(fast.length - brute.length);
    else fast.forEach((e, i) => { worstMin = Math.max(worstMin, Math.abs(e.t - brute[i]) / 60e3); });
    nEv += fast.length;
  }
}
check('event times, bracket + bisection vs 1-min brute force, ' + nEv + ' events at 5 sites over 60 d', 'worst ' + worstMin.toFixed(2) + ' min, ' + missed + ' missed', worstMin < 1 && missed === 0, '< 1 min, none missed');

// 5
const flat = L.makeSite(0, 0, 0);
check('half-set disk on a flat horizon', L.diskFrac(flat, 90, 0, 0.2666).toFixed(4), Math.abs(L.diskFrac(flat, 90, 0, 0.2666) - 0.5) < 1e-6, '0.5');
const seg = L.diskFrac(flat, 90, 0.1333, 0.2666), exact = 1 - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI;
check('disk with centre half a radius above a flat horizon', seg.toFixed(4) + ' vs exact ' + exact.toFixed(4), Math.abs(seg - exact) < 2e-3, 'circular segment +- 0.002');
const g = terrain.sites.ridge && terrain.sites.ridge.grid;
if (g) {
  const zlib = require('zlib'), M = terrain.meta.grid, masks = L.decodeMasks(new Uint8Array(zlib.gunzipSync(Buffer.from(g.gz, 'base64'))), M.n * M.n, M.nb);
  const centre = masks[(M.n * M.n - 1) / 2], full = L.b64i16(terrain.sites.ridge.mask['2']);
  let md = 0; for (let k = 0; k < M.nb; k++) md = Math.max(md, Math.abs(centre[k] - full[2 * k]) / 100);
  check('decoded grid centre mask vs the site mask (0.5 deg vs 0.25 deg bins)', 'max diff ' + md.toFixed(2) + ' deg', masks.length === 441 && md < 1.0, '441 masks, < 1 deg (bin smoothing only)');
}
// 6. DEM-error clones: decode, and compare each clone horizon with the nominal mask at every listed site that has them
const clones = rd('data/clones.json');
{
  const zlib = require('zlib'); let n = 0, worst = 0, sum2 = 0, cnt = 0;
  for (const id of Object.keys(clones.sites)) {
    const c = clones.sites[id], masks = L.decodeMasks(new Uint8Array(zlib.gunzipSync(Buffer.from(c.mask['2'], 'base64'))), c.n, c.nb), nom = L.b64i16(terrain.sites[id].mask['2']);
    n += masks.length;
    for (const m of masks) for (let k = 0; k < c.nb; k++) { const d = (m[k] - nom[k]) / 100; worst = Math.max(worst, Math.abs(d)); sum2 += d * d; cnt++; }
  }
  check('clone horizons vs nominal masks, ' + n + ' clones at ' + Object.keys(clones.sites).length + ' sites', 'RMS ' + Math.sqrt(sum2 / cnt).toFixed(3) + ' deg, largest ' + worst.toFixed(2) + ' deg', n === 160 && Math.sqrt(sum2 / cnt) < 0.5, '160 clones decoded; RMS < 0.5 deg');
}
const pr = L.paretoRanks([{ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 3, b: 0 }, { a: 0, b: 3 }, { a: 1, b: 0 }], [{ key: 'a', max: true }, { key: 'b', max: true }]);
check('Pareto ranks', Array.from(pr).join(','), Array.from(pr).join(',') === '1,0,0,0,2', '1,0,0,0,2');


// 7. Irradiance: the constant, the inverse-square scaling, and the period metrics built on it
{
  check('irradiance at 1 au, full disk', L.irradiance(1, L.AU).toFixed(1) + ' W/m2', L.irradiance(1, L.AU) === 1361 && L.TSI === 1361, '1361 (IAU 2015 Resolution B3)');
  check('irradiance scaling', L.irradiance(0.5, L.AU * 0.98).toFixed(2), Math.abs(L.irradiance(0.5, L.AU * 0.98) - 1361 * 0.5 / 0.9604) < 1e-6, '1361 x 0.5 / 0.98^2');
  const s = siteOf('ridge', 2), ser = L.series(Date.UTC(2027, 2, 5), 30, 60), m = L.metricsFrom(s, ser, 0);
  // independent recomputation, step by step
  let isum = 0, out = 0, outMax = 0, dayMin = Infinity; const irr = [];
  for (let i = 0; i < ser.n; i++) {
    const o = L.look(s, ser.t0 + i * ser.stepMs); irr.push(o.irr); isum += o.irr;
    if (o.earthMargin >= 0) out = 0; else { out++; outMax = Math.max(outMax, out); }
  }
  for (let i = 23; i < ser.n; i++) { let a = 0; for (let k = i - 23; k <= i; k++) a += irr[k]; dayMin = Math.min(dayMin, a / 24); }
  check('metricsFrom irradiance and outage vs step-by-step look()', 'mean ' + m.irrAvg.toFixed(2) + ' vs ' + (isum / ser.n).toFixed(2) + ' W/m2, lowest 24 h ' + m.irrDayMin.toFixed(2) + ' vs ' + dayMin.toFixed(2) + ', outage ' + m.outMaxH + ' vs ' + outMax + ' h',
    Math.abs(m.irrAvg - isum / ser.n) < 0.01 && Math.abs(m.irrDayMin - dayMin) < 0.01 && m.outMaxH === outMax, 'equal');
  check('mean irradiance is bounded by the unobstructed value', m.irrAvg.toFixed(0) + ' <= ' + (1361 * 1.035).toFixed(0), m.irrAvg > 0 && m.irrAvg <= 1361 * 1.035, '0 < mean <= 1361 x 1.035');
}
// 8. Landing probability: exact convolution vs analytic cases and vs a seeded Monte Carlo on the same grid
{
  const n = 41, d = 50, all = new Uint8Array(n * n).fill(1), c = (n - 1) / 2, ci = c * n + c;
  const pa = L.landingProb(all, n, d, 100, 60);
  check('landing probability, every node passes', 'lo ' + pa.lo[ci].toFixed(6) + ', hi ' + pa.hi[ci].toFixed(6), pa.hi[ci] === 1 && pa.lo[ci] > 0.999999, 'hi = 1, lo -> 1 at the centre');
  const half = new Uint8Array(n * n); for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) half[iy * n + ix] = ix >= c + 1 ? 1 : 0;   // passes east of x = +25 m
  const ph = L.landingProb(half, n, d, 100, 60), exact = 0.5 * (1 - L.erf(25 / (100 * Math.SQRT2)));
  check('landing probability, half-plane edge 25 m east of the aim point, sigma 100 m', ph.lo[ci].toFixed(5) + ' vs analytic ' + exact.toFixed(5), Math.abs(ph.lo[ci] - exact) < 2e-4 && Math.abs(ph.hi[ci] - exact) < 2e-4, 'equal to 2e-4');
  const R = L.rng(7), rnd = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) rnd[i] = R() < 0.35 ? 1 : 0;
  // independent of erf and of the separable passes: 1 m midpoint quadrature of the density over every passing cell
  const pr2 = L.landingProb(rnd, n, d, 120, 70); let q = 0;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) if (rnd[iy * n + ix]) {
    let a = 0, b = 0;
    for (let x = (ix - c) * d - d / 2 + 0.5; x < (ix - c) * d + d / 2; x++) a += Math.exp(-x * x / (2 * 120 * 120)) / (120 * Math.sqrt(2 * Math.PI));
    for (let y = (iy - c) * d - d / 2 + 0.5; y < (iy - c) * d + d / 2; y++) b += Math.exp(-y * y / (2 * 70 * 70)) / (70 * Math.sqrt(2 * Math.PI));
    q += a * b;
  }
  let hit = 0; const tot = 6e6, G = L.rng(11);
  for (let k = 0; k < tot; k++) { const ix = Math.round(L.gauss(G) * 120 / d + c), iy = Math.round(L.gauss(G) * 70 / d + c); if (ix >= 0 && iy >= 0 && ix < n && iy < n && rnd[iy * n + ix]) hit++; }
  const mc = hit / tot, se = Math.sqrt(mc * (1 - mc) / tot);
  check('landing probability, random pass map: convolution vs 1 m quadrature (and a 6,000,000-draw Monte Carlo for reference)', pr2.lo[ci].toFixed(5) + ' vs ' + q.toFixed(5) + ' (Monte Carlo ' + mc.toFixed(4) + ' +- ' + se.toFixed(4) + ')', Math.abs(pr2.lo[ci] - q) < 2e-5 && Math.abs(pr2.lo[ci] - mc) < 5 * se, 'quadrature to 2e-5; Monte Carlo within 5 standard errors');
  const fd = L.failDistance(half, n, d);
  check('distance to the nearest failing node', fd[ci + 1] + ' m, ' + fd[ci + 3] + ' m', fd[ci + 1] === 50 && fd[ci + 3] === 150 && fd[ci] === 0, '50 m, 150 m');
}
// 9. Survey: decodes, and each listed polar site agrees with the survey point nearest to it only as far as distance allows
{
  const zlib = require('zlib'), sv = rd('data/survey.json'), P = sv.pts, masks = L.decodeMasks(new Uint8Array(zlib.gunzipSync(Buffer.from(sv.gz, 'base64'))), P.length, sv.meta.nb);
  let bad = 0; for (const m of masks) { let lo = 1e9, hi = -1e9; for (const v of m) { if (v < lo) lo = v; if (v > hi) hi = v; } if (lo < -2000 || hi > 6000 || hi === lo) bad++; }
  check('survey masks decode', masks.length + ' masks of ' + sv.meta.nb + ' bins, ' + bad + ' implausible', masks.length === P.length && P.length === 3600 && bad === 0, '3600 masks, all within -20..60 deg');
  // a survey point that coincides with a listed site (within 30 m) must reproduce that site's own mask numbers
  const ser = L.series(Date.UTC(2027, 2, 5), 30, 60); let nNear = 0, worst = 0; const rows2 = [];
  for (const st of sites) {
    const t = terrain.sites[st.id]; if (!t || st.lat > -85 || !t.mask['2']) continue;
    const own = L.metricsFrom(siteOf(st.id, 2), ser, 0), u = L.unitOf(st.lat, st.lon); let best = -1, bd = 1e9;
    P.forEach((p, k) => { const v = L.unitOf(p[0], p[1]), dd = Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) * L.RM * 1000; if (dd < bd) { bd = dd; best = k; } });
    const p = P[best], sm = L.metricsFrom(L.makeSite(p[0], p[1], p[2] + 2, masks[best], 2), ser, 0);
    rows2.push(st.id + ' ' + Math.round(bd) + ' m: ' + Math.round(own.irrAvg) + ' vs ' + Math.round(sm.irrAvg));
    if (bd < 30) { nNear++; worst = Math.max(worst, Math.abs(own.irrAvg - sm.irrAvg)); }
  }
  console.log('     listed site vs nearest survey point (distance: mean W/m2 own vs survey): ' + rows2.join('; '));
  check('survey points within 30 m of a listed site reproduce its mean irradiance (720 vs 1440 bins)', nNear + ' sites, worst difference ' + worst.toFixed(1) + ' W/m2', nNear >= 1 && worst < 25, '>= 1 site, < 25 W/m2');
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'check_core.json'), JSON.stringify(rows, null, 1));
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
