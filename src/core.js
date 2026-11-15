/* Lunar Window Browser core: ephemeris interpolation, topocentric geometry, horizon masks, finite disks,
   event root-finding, metrics and Pareto sorting. No DOM. Loaded by the page (window.LWB) and by the Node
   tests (require), so every validated number comes from the code the page runs.

   Frame: Moon body-fixed MOON_ME. Vectors are Moon-centred, km. Sites sit on a sphere of RM plus height.
   Azimuth is clockwise from local north; elevation is measured from the plane normal to the radial "up". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LWB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var RM = 1737.4, R_SUN = 695700, R_EARTH = 6378.137, AU = 149597870.7;
/* Total solar irradiance at 1 au: IAU 2015 Resolution B3 nominal value, 1361 W/m2 (solar-cycle-23 mean,
   +-1 W/m2 at 2 sigma; the Sun itself varies by about 0.08 %). R_SUN is the same resolution's nominal radius. */
var TSI = 1361;
var NCHORD = 24;
/* Solar irradiance (W/m2) on a surface facing the Sun: TSI scaled by distance and by the visible fraction of the
   disk's area. Uniform disk: limb darkening is not modelled, so a partly hidden Sun is approximate. */
function irradiance(frac, rangeKm) { var k = AU / rangeKm; return TSI * k * k * frac; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

function b64bytes(s) {
  if (typeof atob === 'function') { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(s, 'base64'));
}
function b64i16(s) { var u = b64bytes(s); return new Int16Array(u.buffer, u.byteOffset, u.length >> 1); }
function b64u16(s) { var u = b64bytes(s); return new Uint16Array(u.buffer, u.byteOffset, u.length >> 1); }

/* ================= ephemeris ================= */
var EPH = null, AE = null;
/* obj: data/ephem.json ({meta, b64}); astronomy: the astronomy-engine namespace (fallback), may be null. */
function init(obj, astronomy) {
  AE = astronomy || null;
  if (obj && obj.b64) {
    var u = b64bytes(obj.b64);
    EPH = { t0: obj.meta.t0_ms, step: obj.meta.step_ms, n: obj.meta.n, a: new Float32Array(u.buffer, u.byteOffset, u.length >> 2), meta: obj.meta };
  } else EPH = null;
  return EPH;
}
function ephRange() { return EPH ? [EPH.t0 + EPH.step, EPH.t0 + (EPH.n - 2) * EPH.step] : null; }
function inSpice(ms) { return !!EPH && ms >= EPH.t0 + EPH.step && ms < EPH.t0 + (EPH.n - 2) * EPH.step; }
/* Catmull-Rom cubic through four grid samples; unit vectors are renormalised. Measured worst error against
   direct SPICE on the 2 h grid: 7e-6 deg (see tools/ephem/make_ephem.py and tests/check_core.js). */
function spiceAt(ms, out) {
  var E = EPH, x = (ms - E.t0) / E.step, i = Math.floor(x), f = x - i, f2 = f * f, f3 = f2 * f, a = E.a;
  var w0 = (-f3 + 2*f2 - f) / 2, w1 = (3*f3 - 5*f2 + 2) / 2, w2 = (-3*f3 + 4*f2 + f) / 2, w3 = (f3 - f2) / 2;
  var o = (i - 1) * 8, k, v = [0, 0, 0, 0, 0, 0, 0, 0];
  for (k = 0; k < 8; k++) v[k] = w0 * a[o + k] + w1 * a[o + 8 + k] + w2 * a[o + 16 + k] + w3 * a[o + 24 + k];
  var ls = v[3] / Math.hypot(v[0], v[1], v[2]), le = v[7] / Math.hypot(v[4], v[5], v[6]);
  out.sun[0] = v[0] * ls; out.sun[1] = v[1] * ls; out.sun[2] = v[2] * ls;
  out.earth[0] = v[4] * le; out.earth[1] = v[5] * le; out.earth[2] = v[6] * le;
  out.src = 'spice';
  return out;
}
/* Fallback outside the precomputed span: astronomy-engine positions with the IAU rotation model.
   Arcminute class; the body-fixed frame is IAU_MOON-like, not MOON_ME. */
function aeAxes(time) {
  var ax = AE.RotationAxis(AE.Body.Moon, time);
  var ra = ax.ra * 15 * D2R, dec = ax.dec * D2R, W = ax.spin * D2R;
  var z = [Math.cos(dec)*Math.cos(ra), Math.cos(dec)*Math.sin(ra), Math.sin(dec)];
  var n = [-Math.sin(ra), Math.cos(ra), 0], zn = cross(z, n);
  var x = [Math.cos(W)*n[0]+Math.sin(W)*zn[0], Math.cos(W)*n[1]+Math.sin(W)*zn[1], Math.cos(W)*n[2]+Math.sin(W)*zn[2]];
  return { x: x, y: cross(z, x), z: z, node: n };
}
function aeAt(ms, out) {
  var time = AE.MakeTime(new Date(ms)), ax = aeAxes(time);
  var m = AE.GeoVector(AE.Body.Moon, time, true), s = AE.GeoVector(AE.Body.Sun, time, true);
  var ts = [(s.x - m.x) * AU, (s.y - m.y) * AU, (s.z - m.z) * AU], te = [-m.x * AU, -m.y * AU, -m.z * AU];
  out.sun[0] = dot(ts, ax.x); out.sun[1] = dot(ts, ax.y); out.sun[2] = dot(ts, ax.z);
  out.earth[0] = dot(te, ax.x); out.earth[1] = dot(te, ax.y); out.earth[2] = dot(te, ax.z);
  out.src = 'ae';
  return out;
}
function newDirs() { return { sun: [0, 0, 0], earth: [0, 0, 0], src: '' }; }
/* Apparent Sun and Earth position from the Moon's centre at UTC ms. */
function dirs(ms, out) {
  out = out || newDirs();
  if (inSpice(ms)) return spiceAt(ms, out);
  if (!AE) throw new Error('time outside the precomputed ephemeris and no fallback loaded');
  return aeAt(ms, out);
}

/* ================= sites and horizons ================= */
function unitOf(lat, lon) { var p = lat * D2R, l = lon * D2R; return [Math.cos(p)*Math.cos(l), Math.cos(p)*Math.sin(l), Math.sin(p)]; }
/* h_m: observer height above the reference sphere (terrain height + mast height), metres.
   mask: Int16Array of horizon elevations in 0.01 deg at azimuth k*360/len, or null for a smooth sphere,
   whose horizon is depressed by acos(R/(R+hobs)) for an observer hobs_m above it. */
function makeSite(lat, lon, h_m, mask, hobs_m) {
  var s = { lat: +lat, lon: +lon };
  s.u = unitOf(s.lat, s.lon);
  var l = s.lon * D2R;
  s.e = [-Math.sin(l), Math.cos(l), 0];
  s.n = cross(s.u, s.e);
  setHorizon(s, h_m || 0, mask || null, hobs_m || 0);
  return s;
}
function setHorizon(s, h_m, mask, hobs_m) {
  s.r = RM + h_m / 1000; s.mask = mask || null;
  if (mask) {
    var lo = 32767, hi = -32768;
    for (var k = 0; k < mask.length; k++) { if (mask[k] < lo) lo = mask[k]; if (mask[k] > hi) hi = mask[k]; }
    s.hMin = lo / 100; s.hMax = hi / 100; s.dip = 0;
  } else {
    s.dip = -Math.acos(RM / (RM + (hobs_m || 0) / 1000)) * R2D;
    s.hMin = s.hMax = s.dip;
  }
}
/* Point reached from (lat, lon) by a local east/north offset in metres (tangent plane; km scale). */
function offsetLatLon(lat, lon, de, dn) {
  var u = unitOf(lat, lon), l = lon * D2R, e = [-Math.sin(l), Math.cos(l), 0], n = cross(u, e), R = RM * 1000;
  var v = [u[0] + (de*e[0] + dn*n[0]) / R, u[1] + (de*e[1] + dn*n[1]) / R, u[2] + (de*e[2] + dn*n[2]) / R];
  var L = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / L) * R2D, lon: Math.atan2(v[1], v[0]) * R2D };
}
/* Topocentric direction of a Moon-centred vector: exact parallax (observer moved to the site). */
function topo(s, v, out) {
  var dx = v[0] - s.r * s.u[0], dy = v[1] - s.r * s.u[1], dz = v[2] - s.r * s.u[2];
  var d = Math.sqrt(dx*dx + dy*dy + dz*dz);
  out = out || {};
  out.el = Math.asin((dx*s.u[0] + dy*s.u[1] + dz*s.u[2]) / d) * R2D;
  var az = Math.atan2(dx*s.e[0] + dy*s.e[1] + dz*s.e[2], dx*s.n[0] + dy*s.n[1] + dz*s.n[2]) * R2D;
  out.az = az < 0 ? az + 360 : az; out.range = d;
  return out;
}
function horizonAt(s, az) {
  var m = s.mask; if (!m) return s.dip;
  var n = m.length, x = az / 360 * n, i = Math.floor(x), f = x - i;
  i = ((i % n) + n) % n;
  return (m[i] * (1 - f) + m[(i + 1) % n] * f) / 100;
}
/* Fraction of a disk (centre az/el, angular radius rad, degrees) above the horizon: the disk is cut into
   vertical chords and each chord is clipped at the mask elevation at that chord's azimuth. */
function diskFrac(s, az, el, rad) {
  if (el - rad >= s.hMax) return 1;
  if (el + rad <= s.hMin) return 0;
  var ce = Math.max(Math.cos(el * D2R), 1e-6), vis = 0, tot = 0;
  for (var k = 0; k < NCHORD; k++) {
    var x = (2 * (k + 0.5) / NCHORD - 1) * rad, c = Math.sqrt(rad * rad - x * x);
    var h = horizonAt(s, az + x / ce);
    vis += clamp(el + c - h, 0, 2 * c); tot += 2 * c;
  }
  return vis / tot;
}
/* Everything the page shows for one site at one instant. */
var _d = newDirs(), _t = {};
function look(s, ms, d) {
  d = d || dirs(ms, _d);
  var o = { src: d.src };
  topo(s, d.sun, _t);
  o.sunAz = _t.az; o.sunEl = _t.el; o.sunRad = Math.asin(R_SUN / _t.range) * R2D; o.sunRange = _t.range;
  o.sunHor = horizonAt(s, o.sunAz); o.sunFrac = diskFrac(s, o.sunAz, o.sunEl, o.sunRad);
  o.irr = irradiance(o.sunFrac, o.sunRange); o.irrFull = irradiance(1, o.sunRange);
  topo(s, d.earth, _t);
  o.earthAz = _t.az; o.earthEl = _t.el; o.earthRad = Math.asin(R_EARTH / _t.range) * R2D; o.earthRange = _t.range;
  o.earthHor = horizonAt(s, o.earthAz); o.earthMargin = o.earthEl - o.earthHor;
  o.earthFrac = diskFrac(s, o.earthAz, o.earthEl, o.earthRad);
  return o;
}
function sunFracAt(s, ms) { var d = dirs(ms, _d); topo(s, d.sun, _t); return diskFrac(s, _t.az, _t.el, Math.asin(R_SUN / _t.range) * R2D); }
function earthMarginAt(s, ms) { var d = dirs(ms, _d); topo(s, d.earth, _t); return _t.el - horizonAt(s, _t.az); }
function sunElAt(s, ms) { var d = dirs(ms, _d); topo(s, d.sun, _t); return _t.el; }

/* ================= events ================= */
/* pred(ms) -> boolean, different at tA and tB. Returns the flip time to within tol ms (default 1 s). */
function refine(pred, tA, tB, tol) {
  var a = pred(tA); tol = tol || 1000;
  while (tB - tA > tol) { var m = (tA + tB) / 2; if (pred(m) === a) tA = m; else tB = m; }
  return (tA + tB) / 2;
}
/* All flips of pred on [t0, t1], bracketed on a uniform grid and refined. Returns [{t, on}] (on = state after). */
function findEdges(pred, t0, t1, stepMs, tol) {
  var out = [], prev = pred(t0);
  for (var t = t0 + stepMs; t <= t1; t += stepMs) {
    var cur = pred(t);
    if (cur !== prev) { out.push({ t: refine(pred, t - stepMs, t, tol), on: cur }); prev = cur; }
  }
  return out;
}

/* ================= metrics over a period ================= */
/* Sun/Earth vectors on a uniform grid, shared by many candidate points. */
function series(t0, days, stepMin) {
  var n = Math.floor(days * 1440 / stepMin) + 1, S = { t0: t0, stepMs: stepMin * 60000, n: n, sun: new Float64Array(n * 3), earth: new Float64Array(n * 3), src: 'spice' };
  var d = newDirs();
  for (var i = 0; i < n; i++) {
    dirs(t0 + i * S.stepMs, d);
    S.sun[i*3] = d.sun[0]; S.sun[i*3+1] = d.sun[1]; S.sun[i*3+2] = d.sun[2];
    S.earth[i*3] = d.earth[0]; S.earth[i*3+1] = d.earth[1]; S.earth[i*3+2] = d.earth[2];
    if (d.src !== 'spice') S.src = d.src;
  }
  return S;
}
/* sunAvg: mean visible fraction of the solar disk. litFrac: share of steps with any Sun (the Mazarico et al.
   2011 "average illumination" definition). earthFrac: share of steps with Earth's centre at least linkMin above
   the local horizon. darkMaxH: longest run with no Sun. sunsetH: hours from the start to the first step with
   no Sun (the whole period if none; 0 if it starts dark). sunEl0/sunFrac0: at the first step. */
/* irrAvg: mean irradiance on a Sun-facing surface, W/m2. irrDayMin: lowest mean over any 24 h inside the period
   (the period mean if it is shorter than 24 h). outMaxH: longest run without the Earth link. gate (optional
   Uint8Array, one per step): an extra condition on the direct link, e.g. a ground station having the Moon in view.
   relay (optional): {k, n, pos: Float64Array(n*k*3) body-fixed km (NaN = undefined), ok: Uint8Array(n*k), minEl: [k]}:
   a step also has a link when some satellite with ok set clears the local skyline by its minEl. */
function relayLink(s, R, i, t) {
  for (var k = 0; k < R.k; k++) {
    var o = i * R.k + k; if (!R.ok[o]) continue;
    var p = [R.pos[o * 3], R.pos[o * 3 + 1], R.pos[o * 3 + 2]];
    topo(s, p, t);
    if (t.el - horizonAt(s, t.az) >= R.minEl[k]) return true;
  }
  return false;
}
function metricsFrom(s, S, linkMin, gate, relay) {
  var n = S.n, v = [0, 0, 0], t = {}, sum = 0, lit = 0, earth = 0, run = 0, dark = 0, sunset = -1, hStep = S.stepMs / 3600000, el0 = 0, f0 = 0;
  var irr = new Float32Array(n), isum = 0, out = 0, outMax = 0;
  for (var i = 0; i < n; i++) {
    v[0] = S.sun[i*3]; v[1] = S.sun[i*3+1]; v[2] = S.sun[i*3+2];
    topo(s, v, t);
    var f = diskFrac(s, t.az, t.el, Math.asin(R_SUN / t.range) * R2D);
    if (i === 0) { el0 = t.el; f0 = f; }
    sum += f; irr[i] = f > 0 ? irradiance(f, t.range) : 0; isum += irr[i];
    if (f > 0) { lit++; run = 0; } else { run++; if (run > dark) dark = run; if (sunset < 0) sunset = i; }
    v[0] = S.earth[i*3]; v[1] = S.earth[i*3+1]; v[2] = S.earth[i*3+2];
    topo(s, v, t);
    if ((t.el - horizonAt(s, t.az) >= linkMin && (!gate || gate[i])) || (relay && relayLink(s, relay, i, t))) { earth++; out = 0; } else { out++; if (out > outMax) outMax = out; }
  }
  var w = Math.round(24 / hStep), dayMin = isum / n;
  if (n > w) { var acc = 0; dayMin = Infinity; for (i = 0; i < n; i++) { acc += irr[i]; if (i >= w) acc -= irr[i - w]; if (i >= w - 1 && acc / w < dayMin) dayMin = acc / w; } }
  return { sunAvg: sum / n, litFrac: lit / n, earthFrac: earth / n, darkMaxH: dark * hStep, sunsetH: (sunset < 0 ? n - 1 : sunset) * hStep, sunEl0: el0, sunFrac0: f0, capped: sunset < 0,
           irrAvg: isum / n, irrDayMin: Math.max(0, dayMin), outMaxH: outMax * hStep };
}

/* ================= landing precision on a grid ================= */
/* pass: Uint8Array(n*n), 1 where a grid node meets the goals (index iy*n+ix, spacing d metres).
   For every node taken as the aim point, the probability that a landing meets the goals when the landing
   point is normally distributed with 1-sigma sa (east) and sb (north) metres. The kernel is the exact integral
   of the normal density over each node's d x d cell (error functions), so nothing is sampled and the result has
   no Monte Carlo noise. Probability mass that falls outside the grid is unknown terrain: lo counts it as a
   miss, hi as a hit. Returns {lo, hi} Float32Arrays. */
function erf(x) { // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
  var s = x < 0 ? -1 : 1; x = Math.abs(x);
  var t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function cellWeights(n, d, sig) { // w[k]: mass of N(0, sig) on the cell centred k*d away, k = 0..n-1
  var w = new Float64Array(n), q = Math.SQRT2 * Math.max(sig, 1e-9);
  for (var k = 0; k < n; k++) w[k] = 0.5 * (erf((k * d + d / 2) / q) - erf((k * d - d / 2) / q));
  return w;
}
function landingProb(pass, n, d, sa, sb) {
  var wx = cellWeights(n, d, sa), wy = cellWeights(n, d, sb), tmp = new Float64Array(n * n), cov = new Float64Array(n * n);
  var lo = new Float32Array(n * n), hi = new Float32Array(n * n), ix, iy, k, a, c;
  for (iy = 0; iy < n; iy++) for (ix = 0; ix < n; ix++) { // east pass
    a = 0; c = 0;
    for (k = 0; k < n; k++) { var w = wx[Math.abs(k - ix)]; if (w < 1e-12) continue; c += w; if (pass[iy * n + k]) a += w; }
    tmp[iy * n + ix] = a; cov[iy * n + ix] = c;
  }
  for (ix = 0; ix < n; ix++) for (iy = 0; iy < n; iy++) { // north pass
    a = 0; c = 0;
    for (k = 0; k < n; k++) { var w2 = wy[Math.abs(k - iy)]; if (w2 < 1e-12) continue; a += w2 * tmp[k * n + ix]; c += w2 * cov[k * n + ix]; }
    lo[iy * n + ix] = a; hi[iy * n + ix] = Math.min(1, a + (1 - c));
  }
  return { lo: lo, hi: hi };
}
/* Distance (m) from each node to the nearest node that fails; Infinity if none fails in the grid. */
function failDistance(pass, n, d) {
  var out = new Float32Array(n * n), bad = [], i, j;
  for (i = 0; i < n * n; i++) if (!pass[i]) bad.push(i);
  for (i = 0; i < n * n; i++) {
    var x = i % n, y = (i - x) / n, best = Infinity;
    for (j = 0; j < bad.length; j++) { var bx = bad[j] % n, by = (bad[j] - bx) / n, q = (bx - x) * (bx - x) + (by - y) * (by - y); if (q < best) best = q; }
    out[i] = Math.sqrt(best) * d;
  }
  return out;
}

/* ================= neighbourhood grids ================= */
/* Inverse of tools/terrain/make_terrain.py delta_code: bytes -> count masks of nb Int16 (0.01 deg). */
function decodeMasks(bytes, count, nb) {
  var out = [], p = 0, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (var m = 0; m < count; m++) {
    var a = new Int16Array(nb), v = dv.getInt16(p, true); p += 2; a[0] = v;
    for (var k = 1; k < nb; k++) {
      var d = dv.getInt8(p++);
      if (d === -128) { v = dv.getInt16(p, true); p += 2; } else v += d;
      a[k] = v;
    }
    out.push(a);
  }
  return out;
}
/* Bilinear blend of the four surrounding grid masks and heights at a local east/north offset (metres).
   G: {n, d, masks: [Int16Array], h: [m]}. Returns {mask, h} or null outside the grid. */
function gridBlend(G, de, dn) {
  var n = G.n, fx = de / G.d + (n - 1) / 2, fy = dn / G.d + (n - 1) / 2;
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return null;
  var ix = Math.min(n - 2, Math.floor(fx)), iy = Math.min(n - 2, Math.floor(fy)), tx = fx - ix, ty = fy - iy;
  var i00 = iy * n + ix, i10 = i00 + 1, i01 = i00 + n, i11 = i01 + 1;
  var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  var a = G.masks[i00], b = G.masks[i10], c = G.masks[i01], e = G.masks[i11], nb = a.length, m = new Int16Array(nb);
  for (var k = 0; k < nb; k++) m[k] = Math.round(a[k] * w00 + b[k] * w10 + c[k] * w01 + e[k] * w11);
  return { mask: m, h: G.h[i00] * w00 + G.h[i10] * w10 + G.h[i01] * w01 + G.h[i11] * w11,
           slope: G.slope[i00] * w00 + G.slope[i10] * w10 + G.slope[i01] * w01 + G.slope[i11] * w11 };
}

/* ================= Pareto ================= */
/* pts: array of objects; objs: [{key, max}] (max true = larger is better). Returns the rank of each point
   (0 = non-dominated front) by fast non-dominated sorting (Deb et al. 2002). */
function paretoRanks(pts, objs) {
  var n = pts.length, S = [], cnt = new Int32Array(n), rank = new Int32Array(n), front = [], i, j, k;
  function dom(a, b) {
    var better = false;
    for (var q = 0; q < objs.length; q++) {
      var x = a[objs[q].key], y = b[objs[q].key];
      if (objs[q].max ? x < y : x > y) return false;
      if (x !== y) better = true;
    }
    return better;
  }
  for (i = 0; i < n; i++) { S.push([]); rank[i] = -1; }
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    if (dom(pts[i], pts[j])) { S[i].push(j); cnt[j]++; } else if (dom(pts[j], pts[i])) { S[j].push(i); cnt[i]++; }
  }
  for (i = 0; i < n; i++) if (!cnt[i]) { rank[i] = 0; front.push(i); }
  var r = 0;
  while (front.length) {
    var next = [];
    for (k = 0; k < front.length; k++) { var s = S[front[k]]; for (j = 0; j < s.length; j++) if (--cnt[s[j]] === 0) { rank[s[j]] = r + 1; next.push(s[j]); } }
    front = next; r++;
  }
  return rank;
}
/* Seeded PRNG (mulberry32) and a standard normal from it, for reproducible Monte Carlo. */
function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(R) { var u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

return {
  RM: RM, R_SUN: R_SUN, R_EARTH: R_EARTH, AU: AU, D2R: D2R, R2D: R2D, TSI: TSI, irradiance: irradiance,
  erf: erf, landingProb: landingProb, failDistance: failDistance,
  init: init, ephRange: ephRange, inSpice: inSpice, dirs: dirs, newDirs: newDirs, aeAxes: aeAxes,
  b64bytes: b64bytes, b64i16: b64i16, b64u16: b64u16,
  makeSite: makeSite, setHorizon: setHorizon, unitOf: unitOf, offsetLatLon: offsetLatLon,
  topo: topo, horizonAt: horizonAt, diskFrac: diskFrac, look: look,
  sunFracAt: sunFracAt, earthMarginAt: earthMarginAt, sunElAt: sunElAt,
  refine: refine, findEdges: findEdges, series: series, metricsFrom: metricsFrom, relayLink: relayLink,
  decodeMasks: decodeMasks, gridBlend: gridBlend, paretoRanks: paretoRanks, rng: rng, gauss: gauss
};
});
