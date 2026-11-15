/* Lunar Window Browser orbit propagator. No DOM. Loaded by the page (window.LWBProp) and by the Node tests (require).

   Equations of motion, Moon-centred ICRF (J2000 Earth-equator axes), km, km/s:
     r'' = -GM r/|r|^3                                   central term, GM of the gravity field (below)
         + A^T grad U_2..N(A r)                           lunar field, degree and order 2..N, in the PA body frame
         + sum_{Earth,Sun} GM_k [ (s_k - r)/|s_k - r|^3 - s_k/|s_k|^3 ]   third bodies, direct and indirect terms
   A (ICRF -> lunar principal axes) = R_ME->PA * A_IAU(t): the IAU/WGCCRE 2009 rotation model as implemented by
   astronomy-engine (the same axes as LWB.aeAxes in core.js), followed by the constant ME->PA rotation of the DE440
   lunar frame kernel. s_k: Earth and Sun from the Moon's centre, geometric, from astronomy-engine.

   Left out: solar radiation pressure, other planets, the Earth's oblateness, lunar and terrestrial tides (the field's
   label gives k2 but no tide model is applied), relativity, thermal and outgassing forces, and manoeuvres.

   Integrator: by default Adams-Bashforth-Moulton (PECE, order 8, fixed step), started by the Gragg-Bulirsch-Stoer
   integrator described next, which is also the reference in the checks (opts.integrator = 'gbs' selects it).
   Gragg-Bulirsch-Stoer (modified midpoint with Gragg smoothing, polynomial extrapolation in h^2, step
   sequence 2, 4, 6, ...) with error control and order selection after Hairer, Norsett & Wanner, Solving ODEs I,
   section II.9. The integrator lands exactly on every output node; output is a uniform grid of position and velocity
   for cubic Hermite interpolation. Steps and tolerance are justified by the convergence check in tests/check_prop.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LWBProp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---- constants, each with the file it was read from ---- */
// gm_de440.tpc (NAIF generic_kernels/pck, "DE-440 NAVIO file ASTRO-VALUES", Park et al. 2021, AJ 161:105)
var GM_EARTH = 3.9860043550702266e5;   // BODY399_GM, km^3/s^2
var GM_SUN = 1.3271244004127942e11;    // BODY10_GM, km^3/s^2
// naif0012.tls: DELTET/DELTA_T_A = 32.184 s (TT - TAI) and DELTET/DELTA_AT = 37 s from 2017-JAN-1 (TAI - UTC)
var TT_UTC_S = 32.184 + 37, TT_UTC_FROM = Date.UTC(2017, 0, 1);
// moon_de440_250416.tf, TKFRAME_31009 (MOON_ME_DE440_ME421 relative to MOON_PA_DE440): ANGLES (67.8526 78.6944 0.2785)
// arcsec, AXES (3 2 1): v_PA = [67.8526"]_3 [78.6944"]_2 [0.2785"]_1 v_ME, where [a]_i is a frame rotation about axis i
// (SPICE eul2m convention). Checked against spiceypy pxform('MOON_PA','MOON_ME') to 1e-16 (tests/check_prop.js A2).
var ME_PA_ARCSEC = [67.8526, 78.6944, 0.2785];
var J2000_MS = Date.UTC(2000, 0, 1, 12);   // the J2000.0 epoch label, 2000-01-01 12:00 (TT for tt days below)

var G = null, AE = null, AU_KM = 0, MEPA = null;

function rot(axis, a) { // SPICE frame rotation [a]_axis (rotates the frame, not the vector)
  var c = Math.cos(a), s = Math.sin(a);
  if (axis === 1) return [[1, 0, 0], [0, c, s], [0, -s, c]];
  if (axis === 2) return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
function mm(a, b) { var o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]; return o; }
function mePaMatrix() {
  var k = Math.PI / 180 / 3600;
  return mm(rot(3, ME_PA_ARCSEC[0] * k), mm(rot(2, ME_PA_ARCSEC[1] * k), rot(1, ME_PA_ARCSEC[2] * k)));
}

/* gravity: parsed data/gravity.json; astronomy: the astronomy-engine namespace (2.1.19). */
function init(gravity, astronomy) {
  AE = astronomy;
  AU_KM = astronomy.KM_PER_AU;   // astronomy-engine's own au, to convert its vectors
  MEPA = mePaMatrix();
  var N = gravity.degree, nn = (N + 1) * (N + 2) / 2;
  G = { N: N, gm: gravity.gm_km3_s2, R: gravity.r_ref_km, C: new Float64Array(nn), S: new Float64Array(nn), src: gravity };
  for (var i = 0; i < nn; i++) { G.C[i] = gravity.C[i]; G.S[i] = gravity.S[i]; }
  TABLES = {};
  info.gravity.degree_available = N;
  info.gravity.gm_km3_s2 = G.gm;
  info.gravity.r_ref_km = G.R;
  return G;
}

/* ---- recursion factors for the normalised Cunningham V/W functions (Montenbruck & Gill 2000, sec. 3.2.4, with the
   unnormalised V_nm, C_nm replaced by N_nm V_nm and C_nm / N_nm, N_nm = sqrt((2 - d_m0)(2n + 1)(n - m)!/(n + m)!)) ---- */
var TABLES = {};
function tables(N) {
  if (TABLES[N]) return TABLES[N];
  var M = N + 1, sz = (M + 1) * (M + 2) / 2;
  var dg = new Float64Array(M + 1), a = new Float64Array(sz), b = new Float64Array(sz);
  var f1 = new Float64Array(sz), f2 = new Float64Array(sz), f3 = new Float64Array(sz);
  for (var m = 1; m <= M; m++) dg[m] = Math.sqrt((m === 1 ? 2 : 1) * (2 * m + 1) / (2 * m));
  for (var n = 0; n <= M; n++) for (m = 0; m <= n; m++) {
    var k = n * (n + 1) / 2 + m;
    if (n > m) {
      a[k] = Math.sqrt((2 * n - 1) * (2 * n + 1) / ((n - m) * (n + m)));
      b[k] = n - m >= 2 ? Math.sqrt((2 * n + 1) * (n + m - 1) * (n - m - 1) / ((2 * n - 3) * (n + m) * (n - m))) : 0;
    }
    if (n <= N) {
      var q = (2 * n + 1) / (2 * n + 3);
      f1[k] = Math.sqrt((m === 0 ? 0.5 : 1) * q * (n + m + 1) * (n + m + 2));          // N_nm / N_n+1,m+1
      f2[k] = m >= 1 ? Math.sqrt((m === 1 ? 2 : 1) * q * (n - m + 2) * (n - m + 1)) : 0; // (n-m+2)(n-m+1) N_nm / N_n+1,m-1
      f3[k] = Math.sqrt(q * (n + m + 1) * (n - m + 1));                                // (n-m+1) N_nm / N_n+1,m
    }
  }
  var T = { N: N, M: M, dg: dg, a: a, b: b, f1: f1, f2: f2, f3: f3, V: new Float64Array(sz), W: new Float64Array(sz) };
  TABLES[N] = T;
  return T;
}

/* Acceleration (km/s^2) of the degree 2..N field at body-fixed position x (km), into out[0..2]. */
function fieldAccel(x, N, out) {
  var T = tables(N), V = T.V, W = T.W, a = T.a, b = T.b, dg = T.dg, M = T.M, R = G.R;
  var r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2], rho = R / r2;
  var x0 = x[0] * rho, y0 = x[1] * rho, z0 = x[2] * rho, rr = R * rho;
  V[0] = R / Math.sqrt(r2); W[0] = 0;
  for (var m = 0; m <= M; m++) {
    var km = m * (m + 1) / 2 + m;
    if (m > 0) {
      var kp = (m - 1) * m / 2 + m - 1;
      V[km] = dg[m] * (x0 * V[kp] - y0 * W[kp]);
      W[km] = dg[m] * (x0 * W[kp] + y0 * V[kp]);
    }
    if (m < M) {
      var k1 = (m + 1) * (m + 2) / 2 + m;
      V[k1] = a[k1] * z0 * V[km]; W[k1] = a[k1] * z0 * W[km];
    }
    for (var n = m + 2; n <= M; n++) {
      var k = n * (n + 1) / 2 + m, k_1 = k - n, k_2 = k_1 - n + 1;
      V[k] = a[k] * z0 * V[k_1] - b[k] * rr * V[k_2];
      W[k] = a[k] * z0 * W[k_1] - b[k] * rr * W[k_2];
    }
  }
  var C = G.C, S = G.S, f1 = T.f1, f2 = T.f2, f3 = T.f3, ax = 0, ay = 0, az = 0;
  for (n = 2; n <= N; n++) {
    var o = n * (n + 1) / 2, o1 = (n + 1) * (n + 2) / 2;   // row starts of degree n and n + 1
    // m = 0
    var c = C[o];
    ax -= c * f1[o] * V[o1 + 1];
    ay -= c * f1[o] * W[o1 + 1];
    az -= c * f3[o] * V[o1];
    for (m = 1; m <= n; m++) {
      var i = o + m; c = C[i]; var s = S[i];
      var vp = V[o1 + m + 1], wp = W[o1 + m + 1], vm = V[o1 + m - 1], wm = W[o1 + m - 1];
      var g1 = f1[i], g2 = f2[i];
      ax += 0.5 * (-g1 * (c * vp + s * wp) + g2 * (c * vm + s * wm));
      ay += 0.5 * (-g1 * (c * wp - s * vp) + g2 * (-c * wm + s * vm));
      az -= f3[i] * (c * V[o1 + m] + s * W[o1 + m]);
    }
  }
  var k0 = G.gm / (R * R);
  out[0] = ax * k0; out[1] = ay * k0; out[2] = az * k0;
  return out;
}

/* Potential of the degree 2..N part (km^2/s^2) at body-fixed x, by an independent route (normalised associated
   Legendre functions, standard forward column recursion). Used only by the tests to check fieldAccel's gradient. */
function fieldPotential(x, N) {
  var r = Math.hypot(x[0], x[1], x[2]), sp = x[2] / r, cp = Math.hypot(x[0], x[1]) / r, lam = Math.atan2(x[1], x[0]);
  var P = [], u = 0, n, m;
  for (n = 0; n <= N; n++) P.push(new Float64Array(n + 1));
  P[0][0] = 1;
  for (m = 1; m <= N; m++) P[m][m] = cp * P[m - 1][m - 1] * Math.sqrt((m === 1 ? 2 : 1) * (2 * m + 1) / (2 * m));
  for (m = 0; m <= N; m++) for (n = m + 1; n <= N; n++) {
    var an = Math.sqrt((2 * n - 1) * (2 * n + 1) / ((n - m) * (n + m)));
    var bn = n - m >= 2 ? Math.sqrt((2 * n + 1) * (n + m - 1) * (n - m - 1) / ((2 * n - 3) * (n + m) * (n - m))) : 0;
    P[n][m] = an * sp * P[n - 1][m] - (n - m >= 2 ? bn * P[n - 2][m] : 0);
  }
  for (n = 2; n <= N; n++) {
    var t = 0;
    for (m = 0; m <= n; m++) { var i = n * (n + 1) / 2 + m; t += P[n][m] * (G.C[i] * Math.cos(m * lam) + G.S[i] * Math.sin(m * lam)); }
    u += Math.pow(G.R / r, n) * t;
  }
  return G.gm / r * u;
}

/* ---- Moon orientation and third bodies from astronomy-engine ---- */
function aeTime(ms) {
  if (ms >= TT_UTC_FROM) return AE.AstroTime.FromTerrestrialTime((ms - J2000_MS) / 864e5 + TT_UTC_S / 86400);
  return AE.MakeTime(new Date(ms));   // before 2017: astronomy-engine's own Delta-T model
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
/* IAU rotation model axes in ICRF; the same construction as LWB.aeAxes in src/core.js (copied, not imported). */
function aeAxes(time) {
  var D2R = Math.PI / 180, ax = AE.RotationAxis(AE.Body.Moon, time);
  var ra = ax.ra * 15 * D2R, dec = ax.dec * D2R, W = ax.spin * D2R;
  var z = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  var n = [-Math.sin(ra), Math.cos(ra), 0], zn = cross(z, n);
  var x = [Math.cos(W) * n[0] + Math.sin(W) * zn[0], Math.cos(W) * n[1] + Math.sin(W) * zn[1], Math.cos(W) * n[2] + Math.sin(W) * zn[2]];
  return { x: x, y: cross(z, x), z: z };
}
/* 15 numbers at UTC ms: Earth from the Moon (km), Sun from the Moon (km), then the 3x3 matrix ICRF -> body (row major).
   pa: apply the ME -> PA rotation (true for the GRAIL field). */
function ephemAt(ms, pa, out) {
  var t = aeTime(ms), gm = AE.GeoMoon(t), he = AE.HelioVector(AE.Body.Earth, t), ax = aeAxes(t);
  out[0] = -gm.x * AU_KM; out[1] = -gm.y * AU_KM; out[2] = -gm.z * AU_KM;
  out[3] = -(he.x + gm.x) * AU_KM; out[4] = -(he.y + gm.y) * AU_KM; out[5] = -(he.z + gm.z) * AU_KM;
  var A = [ax.x, ax.y, ax.z];
  if (pa) A = mm(MEPA, A);
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[6 + i * 3 + j] = A[i][j];
  return out;
}
/* Ephemeris on a grid (step EPH_MS), filled lazily, cubic Lagrange through 4 nodes. */
var EPH_MS = 3600000;
function EphGrid(tA, tB, pa) {
  this.t0 = Math.floor(tA / EPH_MS) * EPH_MS - 2 * EPH_MS;
  this.n = Math.ceil((tB - this.t0) / EPH_MS) + 3;
  this.d = new Float64Array(this.n * 15); this.ok = new Uint8Array(this.n); this.pa = pa; this.tmp = new Float64Array(15);
}
EphGrid.prototype.node = function (i) {
  if (!this.ok[i]) { ephemAt(this.t0 + i * EPH_MS, this.pa, this.tmp); this.d.set(this.tmp, i * 15); this.ok[i] = 1; }
  return i * 15;
};
EphGrid.prototype.at = function (ms, out) {
  var x = (ms - this.t0) / EPH_MS, i = Math.floor(x) - 1, u = x - i - 1;
  if (i < 0 || i + 3 >= this.n) throw new Error('time outside the ephemeris grid');
  var o0 = this.node(i), o1 = this.node(i + 1), o2 = this.node(i + 2), o3 = this.node(i + 3), d = this.d;
  // Lagrange weights for nodes at -1, 0, 1, 2 and u in [0, 1)
  var w0 = -u * (u - 1) * (u - 2) / 6, w1 = (u + 1) * (u - 1) * (u - 2) / 2, w2 = -(u + 1) * u * (u - 2) / 2, w3 = (u + 1) * u * (u - 1) / 6;
  for (var k = 0; k < 15; k++) out[k] = w0 * d[o0 + k] + w1 * d[o1 + k] + w2 * d[o2 + k] + w3 * d[o3 + k];
  return out;
};

/* ---- force model ---- */
function Model(o, tA, tB) {
  this.N = o.twoBody ? 0 : Math.min(o.degree, G.N);
  this.third = !o.twoBody && o.thirdBodies !== false;
  this.eph = (this.N >= 2 || this.third) ? new EphGrid(tA, tB, o.pa !== false) : null;
  this.e = new Float64Array(15); this.xb = [0, 0, 0]; this.ab = [0, 0, 0];
  this.evals = 0; this.epochMs = o.epochMs;
}
/* dy = f(t, y), t in seconds from the epoch, y = [r, v] */
Model.prototype.f = function (t, y, dy) {
  this.evals++;
  var x = y[0], yy = y[1], z = y[2], r2 = x * x + yy * yy + z * z, r = Math.sqrt(r2), k = -G.gm / (r2 * r);
  var ax = k * x, ay = k * yy, az = k * z;
  if (this.eph) {
    var e = this.eph.at(this.epochMs + t * 1000, this.e);
    if (this.N >= 2) {
      var xb = this.xb, ab = this.ab;
      xb[0] = e[6] * x + e[7] * yy + e[8] * z; xb[1] = e[9] * x + e[10] * yy + e[11] * z; xb[2] = e[12] * x + e[13] * yy + e[14] * z;
      fieldAccel(xb, this.N, ab);
      ax += e[6] * ab[0] + e[9] * ab[1] + e[12] * ab[2];
      ay += e[7] * ab[0] + e[10] * ab[1] + e[13] * ab[2];
      az += e[8] * ab[0] + e[11] * ab[1] + e[14] * ab[2];
    }
    if (this.third) for (var b = 0; b < 2; b++) {
      var gm = b ? GM_SUN : GM_EARTH, sx = e[b * 3], sy = e[b * 3 + 1], sz = e[b * 3 + 2];
      var dx = sx - x, dyy = sy - yy, dz = sz - z, d2 = dx * dx + dyy * dyy + dz * dz, d3 = d2 * Math.sqrt(d2);
      var s2 = sx * sx + sy * sy + sz * sz, s3 = s2 * Math.sqrt(s2);
      ax += gm * (dx / d3 - sx / s3); ay += gm * (dyy / d3 - sy / s3); az += gm * (dz / d3 - sz / s3);
    }
  }
  dy[0] = y[3]; dy[1] = y[4]; dy[2] = y[5]; dy[3] = ax; dy[4] = ay; dy[5] = az;
};

/* ---- Gragg-Bulirsch-Stoer ---- */
var KMAX = 10, SEQ = [], WORK = [];
(function () { var w = 1; for (var j = 0; j <= KMAX; j++) { SEQ.push(2 * (j + 1)); w += SEQ[j]; WORK.push(w); } })();
function Gbs(model, tol) {
  this.m = model; this.tol = tol; this.kopt = 4; this.H = 0;
  this.T = []; for (var j = 0; j <= KMAX; j++) this.T.push(new Float64Array(6));
  this.f0 = new Float64Array(6); this.z0 = new Float64Array(6); this.z1 = new Float64Array(6); this.zt = new Float64Array(6); this.fz = new Float64Array(6);
  this.steps = 0; this.rejects = 0;
}
// modified midpoint with n substeps over H from (t, y) with f0 = f(t, y); result into out
Gbs.prototype.midpoint = function (t, y, H, n, out) {
  var h = H / n, z0 = this.z0, z1 = this.z1, zt = this.zt, f = this.fz, f0 = this.f0, i, k;
  for (k = 0; k < 6; k++) { z0[k] = y[k]; z1[k] = y[k] + h * f0[k]; }
  for (i = 1; i < n; i++) {
    this.m.f(t + i * h, z1, f);
    for (k = 0; k < 6; k++) { var zn = z0[k] + 2 * h * f[k]; z0[k] = z1[k]; z1[k] = zn; }
  }
  this.m.f(t + H, z1, f);
  for (k = 0; k < 6; k++) out[k] = 0.5 * (z1[k] + z0[k] + h * f[k]);
};
// error norm of the difference a - b, positions and velocities scaled separately
Gbs.prototype.err = function (a, b, y) {
  var rp = Math.max(Math.hypot(y[0], y[1], y[2]), Math.hypot(a[0], a[1], a[2])), rv = Math.max(Math.hypot(y[3], y[4], y[5]), Math.hypot(a[3], a[4], a[5]));
  var s = 0;
  for (var k = 0; k < 6; k++) { var q = (a[k] - b[k]) / (this.tol * (k < 3 ? rp : rv)); s += q * q; }
  return Math.sqrt(s / 6);
};
/* One attempted step of size H (signed) from (t, y). On success writes y and returns the step taken; on rejection
   returns 0 and shrinks H. */
Gbs.prototype.step = function (t, y, H) {
  var T = this.T, kopt = this.kopt, Hn = [], W = [], j, k, acc = -1, prev = new Float64Array(6);
  this.m.f(t, y, this.f0);
  for (j = 0; j <= Math.min(kopt + 1, KMAX); j++) {
    this.midpoint(t, y, H, SEQ[j], T[j]);
    // Aitken-Neville in h^2; T[j] holds the newest diagonal, Tk the row
    if (j === 0) { this.row = [new Float64Array(T[0])]; continue; }
    var row = [new Float64Array(T[j])], old = this.row;
    for (k = 1; k <= j; k++) {
      var rk = new Float64Array(6), q = SEQ[j] / SEQ[j - k], den = q * q - 1;
      for (var c = 0; c < 6; c++) rk[c] = row[k - 1][c] + (row[k - 1][c] - old[k - 1][c]) / den;
      row.push(rk);
    }
    this.row = row;
    var e = this.err(row[j], row[j - 1], y);
    Hn[j] = H * Math.min(4, Math.max(0.02, 0.94 * Math.pow(0.65 / Math.max(e, 1e-300), 1 / (2 * j + 1))));
    W[j] = WORK[j] / Math.abs(Hn[j]);
    if (j >= kopt - 1 && e <= 1) { acc = j; break; }
  }
  if (acc < 0) {  // not converged by column kopt + 1
    this.rejects++;
    var jj = Math.min(kopt, j - 1); this.H = Hn[jj] || H * 0.3;
    if (Math.abs(this.H) > 0.5 * Math.abs(H)) this.H = 0.5 * H;
    return 0;
  }
  var sol = this.row[acc];
  for (k = 0; k < 6; k++) y[k] = sol[k];
  this.steps++;
  // order and step for the next step
  if (acc >= 2 && W[acc - 1] < 0.8 * W[acc]) { this.kopt = Math.max(2, acc - 1); this.H = Hn[acc - 1]; }
  else if (acc + 1 < KMAX && (acc < 2 || W[acc] < 0.9 * W[acc - 1])) { this.kopt = acc + 1; this.H = Hn[acc] * WORK[acc + 1] / WORK[acc]; }
  else { this.kopt = Math.max(2, acc); this.H = Hn[acc]; }
  return H;
};
/* Integrate from t to tEnd (seconds), landing exactly on tEnd; y updated in place. Returns false if it stopped
   because the step budget ran out (call again). */
Gbs.prototype.run = function (t, y, tEnd, deadline, now) {
  var dir = tEnd >= t ? 1 : -1;
  while (dir * (tEnd - t) > 1e-9) {
    if (!this.H || this.H * dir <= 0) this.H = dir * Math.min(60, Math.abs(tEnd - t));
    var H = this.H, last = false;
    if (dir * (t + H - tEnd) >= 0) { H = tEnd - t; last = true; }
    var keepH = this.H, took = this.step(t, y, H);
    if (took) {
      t = last ? tEnd : t + took;
      // a step shortened to land on tEnd: if it did not ask for a smaller step, keep the earlier, larger one
      if (last && Math.abs(this.H) >= Math.abs(H)) this.H = dir * Math.max(Math.abs(this.H), Math.abs(keepH));
    }
    this.t = t;
    if (deadline && now() > deadline) return dir * (tEnd - t) <= 1e-9;
  }
  this.t = tEnd;
  return true;
};

/* ---- Adams-Bashforth-Moulton, fixed step, PECE ----
   Backward-difference coefficients from their generating functions (Hairer, Norsett & Wanner I, sec. III.1):
   AB: sum_{i=0..j} g_{j-i}/(i+1) = 1;  AM: sum_{i=0..j} g*_{j-i}/(i+1) = [j == 0]. Converted to ordinate form
   beta_i = (-1)^i sum_{j>=i} g_j binom(j, i). Predictor AB with k back values, corrector AM with k back values plus the
   predicted point (order k + 1). Started with k - 1 Bulirsch-Stoer steps of the same size. */
function abmCoef(k) {
  var g = [1], gs = [1], j, i;
  for (j = 1; j <= k; j++) {
    var s = 1, ss = 0;
    for (i = 1; i <= j; i++) { s -= g[j - i] / (i + 1); ss -= gs[j - i] / (i + 1); }
    g.push(s); gs.push(ss);
  }
  function binom(n, r) { var b = 1; for (var q = 1; q <= r; q++) b = b * (n - r + q) / q; return b; }
  var bp = [], bc = [];
  for (i = 0; i < k; i++) { var t = 0; for (j = i; j < k; j++) t += g[j] * binom(j, i); bp.push((i % 2 ? -1 : 1) * t); }
  for (i = 0; i <= k; i++) { var u = 0; for (j = i; j <= k; j++) u += gs[j] * binom(j, i); bc.push((i % 2 ? -1 : 1) * u); }
  return { k: k, bp: bp, bc: bc };
}
function Abm(model, h, k, tolStart) {
  this.m = model; this.h = h; this.c = abmCoef(k); this.k = k; this.tolStart = tolStart;
  this.F = [];          // back values of f, newest first (Float64Array(6) each)
  this.yp = new Float64Array(6); this.fp = new Float64Array(6);
}
/* Advance one step from (t, y) (y updated). */
Abm.prototype.step = function (t, y) {
  var k = this.k, h = this.h, F = this.F, c = this.c, q, i;
  if (F.length === 0) { var f0 = new Float64Array(6); this.m.f(t, y, f0); F.unshift(f0); }
  if (F.length < k) {   // start-up: one accurate single step
    var g = new Gbs(this.m, this.tolStart); g.H = h;
    g.run(t, y, t + h);
    var f1 = new Float64Array(6); this.m.f(t + h, y, f1); F.unshift(f1);
    return;
  }
  var yp = this.yp, fp = this.fp;
  for (q = 0; q < 6; q++) { var s = 0; for (i = 0; i < k; i++) s += c.bp[i] * F[i][q]; yp[q] = y[q] + h * s; }
  this.m.f(t + h, yp, fp);
  for (q = 0; q < 6; q++) { var s2 = c.bc[0] * fp[q]; for (i = 1; i <= k; i++) s2 += c.bc[i] * F[i - 1][q]; y[q] = y[q] + h * s2; }
  var fn = F.length >= k ? F.pop() : new Float64Array(6);
  if (this.pec) for (q = 0; q < 6; q++) fn[q] = fp[q]; // PEC: keep f at the predicted point (one evaluation per step)
  else this.m.f(t + h, y, fn);                          // PECE
  F.unshift(fn);
};

/* ---- output step ---- */
/* Uniform output step (ms) such that cubic Hermite interpolation of a Kepler orbit is within interpKm at periapsis:
   error ~ r w^4 h^4 / 384 for motion on a circle of radius r at rate w (the 4th derivative bound of the cubic Hermite
   remainder); w and r from the osculating periapsis. Measured in tests/check_prop.js. */
function outputStep(r, v, interpKm) {
  var gm = G.gm, rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  var h = cross(r, v), hn = Math.hypot(h[0], h[1], h[2]), a = 1 / (2 / rn - v2 / gm);
  var e = a > 0 ? Math.sqrt(Math.max(0, 1 - hn * hn / (gm * a))) : 1, rp = a > 0 ? a * (1 - e) : rn;
  var w = hn / (rp * rp);                       // angular rate at periapsis
  var hs = Math.pow(384 * interpKm / (rp * Math.pow(w, 4)), 0.25);
  return Math.max(10, Math.min(3600, Math.floor(hs))) * 1000;
}

/* Default degree by osculating periapsis altitude at the epoch (info.degreeRule). Chosen from the truncation study in
   tests/check_prop.js (each degree against degree 100, docs/validation.md sixth pass): below 150 km, degree 60 keeps the
   truncation error at 7 days (0.06-1.6 km) at or below the error against Horizons, where degree 40 gives 0.3-5 km;
   the eccentric ARTEMIS orbits (periapsis 230-1100 km) need 16-30, CAPSTONE (NRHO) 8. Band 150-400 km for a near-
   circular orbit is not covered by any test spacecraft; 30 there is an interpolation, not a measurement. */
function periapsisAltitude(r, v) {
  var gm = G.gm, rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  var h = cross(r, v), hn = Math.hypot(h[0], h[1], h[2]), a = 1 / (2 / rn - v2 / gm);
  var e = a > 0 ? Math.sqrt(Math.max(0, 1 - hn * hn / (gm * a))) : 1;
  return (a > 0 ? a * (1 - e) : rn) - RMEAN;
}
var RMEAN = 1737.4;  // mean lunar radius used by the page (src/core.js RM) for altitudes
var DEGREE_RULE = [[150, 60], [400, 30], [1500, 16], [Infinity, 8]];   // [periapsis altitude below km, degree]
function defaultDegree(r, v) {
  var h = periapsisAltitude(r, v);
  for (var i = 0; i < DEGREE_RULE.length; i++) if (h < DEGREE_RULE[i][0]) return Math.min(DEGREE_RULE[i][1], G ? G.N : 0);
  return 8;
}

/* ---- jobs ---- */
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
/* opts: { r:[km], v:[km/s] Moon-centred ICRF at epochMs (UTC ms); t0Ms, t1Ms: output span (UTC ms), either side of the
   epoch; degree (default: defaultDegree); tol (default 1e-12); interpKm (default 0.005); stepMs (overrides);
   thirdBodies (default true); pa (default true: ME->PA rotation); twoBody (true: central term only) } */
/* Angular rate at the osculating periapsis (rad/s): sets the integration and output steps. */
function periRate(r, v) {
  var gm = G.gm, rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  var h = cross(r, v), hn = Math.hypot(h[0], h[1], h[2]), a = 1 / (2 / rn - v2 / gm);
  var e = a > 0 ? Math.sqrt(Math.max(0, 1 - hn * hn / (gm * a))) : 1, rp = a > 0 ? a * (1 - e) : rn;
  return hn / (rp * rp);
}
/* ABM step = hScale / (periapsis angular rate), hScale = min(0.05, 0.9 / degree): a degree-N field varies N times
   faster along the track than the orbit, so the step shrinks with N. Order 8. Both chosen by the convergence scan
   recorded in docs/validation.md (sixth pass) and re-checked for every default configuration by tests/check_prop.js. */
var ORDER = 8;
function hScaleFor(N) { return Math.min(0.05, 0.9 / Math.max(N, 1)); }
function start(o) {
  if (!G) throw new Error('LWBProp.init(gravity, Astronomy) first');
  o = Object.assign({}, o);
  if (o.degree == null) o.degree = defaultDegree(o.r, o.v);
  var tol = o.tol || 1e-12, step = o.stepMs || outputStep(o.r, o.v, o.interpKm || 0.005);
  var useAbm = (o.integrator || 'abm') === 'abm';
  // ABM step: the output step divided into m equal steps no longer than hScale / periapsis rate
  var hMax = (o.hScale || hScaleFor(o.twoBody ? 0 : o.degree)) / periRate(o.r, o.v), m = Math.max(1, Math.ceil(step / 1000 / hMax)), hAbm = step / 1000 / m;
  var t0 = o.t0Ms;
  var n = Math.max(2, Math.ceil((o.t1Ms - t0) / step) + 1);
  var tEnd = t0 + (n - 1) * step;
  var model = new Model(o, Math.min(t0, o.epochMs) - step, Math.max(tEnd, o.epochMs) + step);
  var P = new Float64Array(n * 3), Vv = new Float64Array(n * 3);
  // nodes before / after the epoch
  var kb = Math.floor((o.epochMs - t0) / step);   // last node at or before the epoch (may be -1 or >= n)
  var phases = [];
  if (kb >= 0) phases.push({ dir: -1, k: Math.min(kb, n - 1) });
  if (kb + 1 <= n - 1) phases.push({ dir: 1, k: Math.max(kb + 1, 0) });
  var job = {
    progress: 0, done: false, opts: o, model: model, stepMs: step, n: n, t0: t0, evals: 0, wallMs: 0,
    integrator: useAbm ? 'abm' : 'gbs', hSec: useAbm ? hAbm : null, order: useAbm ? (o.order || ORDER) : null,
    _ph: 0, _y: null, _t: 0, _g: null, _a: null, _count: 0
  };
  function store(k) {
    var y = job._y;
    P[k * 3] = y[0]; P[k * 3 + 1] = y[1]; P[k * 3 + 2] = y[2]; Vv[k * 3] = y[3]; Vv[k * 3 + 1] = y[4]; Vv[k * 3 + 2] = y[5];
    job._count++;
  }
  function pause(t0w) { job.wallMs += nowMs() - t0w; job.progress = job._count / n; job.evals = model.evals; return false; }
  job.advance = function (budgetMs) {
    var t0w = nowMs(), deadline = budgetMs ? t0w + budgetMs : 0;
    while (job._ph < phases.length) {
      var ph = phases[job._ph];
      if (!ph.started) {
        job._y = new Float64Array([o.r[0], o.r[1], o.r[2], o.v[0], o.v[1], o.v[2]]);
        job._t = 0; job._g = new Gbs(model, tol); job._a = null; ph.started = true; ph.sub = 0;
      }
      while (ph.k >= 0 && ph.k < n) {
        var tk = (t0 + ph.k * step - o.epochMs) / 1000;
        if (!useAbm || !job._a) {
          // Bulirsch-Stoer to the node (always for the first node: the epoch is generally off the grid)
          var fin = job._g.run(job._t, job._y, tk, deadline, nowMs);
          job._t = job._g.t;
          if (!fin) return pause(t0w);
          store(ph.k); ph.k += ph.dir;
          if (useAbm) { job._a = new Abm(model, ph.dir * hAbm, job.order, tol); job._a.pec = !!o.pec; }
        } else {
          // m ABM steps per node
          while (ph.sub < m) {
            job._a.step(job._t, job._y);
            ph.sub++;
            job._t = ph.sub === m ? tk : job._t + job._a.h;
            if (deadline && nowMs() > deadline && ph.sub < m) return pause(t0w);
          }
          ph.sub = 0; store(ph.k); ph.k += ph.dir;
        }
        if (deadline && nowMs() > deadline) return pause(t0w);
      }
      job._ph++;
    }
    job.wallMs += nowMs() - t0w; job.progress = 1; job.done = true; job.evals = model.evals;
    return true;
  };
  job.result = function () {
    if (!job.done) return null;
    return { t0: t0, stepMs: step, n: n, p: P, v: Vv, degree: model.N, thirdBodies: model.third, evals: model.evals, wallMs: job.wallMs,
      integrator: job.integrator, hSec: job.hSec, order: job.order };
  };
  return job;
}
function propagate(o) { var j = start(o); j.advance(0); return j.result(); }

/* Cubic Hermite interpolation of a result at UTC ms (null outside the grid). */
function at(res, ms, out) {
  var x = (ms - res.t0) / res.stepMs, i = Math.floor(x);
  if (i < 0 || i > res.n - 1 || (i === res.n - 1 && x > i)) return null;
  if (i === res.n - 1) i = res.n - 2;
  var u = x - i, h = res.stepMs / 1000, p = res.p, v = res.v, o = i * 3, q = o + 3;
  var h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
  var d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
  out = out || { p: [0, 0, 0], v: [0, 0, 0] };
  for (var k = 0; k < 3; k++) {
    out.p[k] = h00 * p[o + k] + h10 * h * v[o + k] + h01 * p[q + k] + h11 * h * v[q + k];
    out.v[k] = d00 * p[o + k] + d10 * v[o + k] + d01 * p[q + k] + d11 * v[q + k];
  }
  return out;
}

var info = {
  summary: 'Numerical propagation with the GRAIL GRGM1200A lunar gravity field (degree and order 60 for periapsis below 150 km, '
    + '30 below 400 km, 16 below 1500 km, 8 above), Earth and Sun as point-mass third bodies (DE440 masses, astronomy-engine '
    + 'positions); solar radiation pressure, other planets, tides, relativity and manoeuvres are not modelled.',
  frame: 'Moon-centred ICRF (J2000 Earth-equator axes); km, km/s; time UTC ms',
  gravity: {
    model: 'GRGM1200A (GRAIL, NASA GSFC), PDS GRAIL-L-LGRS-5-RDR-V1.0 GGGRX_1200A_SHA.TAB, fully normalised, principal-axis frame',
    gm_source: 'header record of GGGRX_1200A_SHA.TAB', degree_available: 0, gm_km3_s2: 0, r_ref_km: 0
  },
  thirdBodies: {
    earth_gm_km3_s2: GM_EARTH, sun_gm_km3_s2: GM_SUN,
    gm_source: 'NAIF gm_de440.tpc (BODY399_GM, BODY10_GM; DE440 values, Park et al. 2021)',
    positions: 'astronomy-engine 2.1.19 GeoMoon and HelioVector(Earth), geometric, on a 1 h grid with cubic interpolation'
  },
  orientation: 'IAU/WGCCRE 2009 lunar rotation model (astronomy-engine RotationAxis) then the constant ME->PA rotation of '
    + 'moon_de440_250416.tf (67.8526", 78.6944", 0.2785", axes 3-2-1)',
  time: 'TT = UTC + 69.184 s from 2017-01-01 (naif0012.tls); before 2017 astronomy-engine\'s Delta-T model',
  leftOut: ['solar radiation pressure', 'other planets', 'Earth oblateness', 'lunar and Earth tides (no k2 tide)',
    'relativity', 'thermal / outgassing forces', 'manoeuvres (station keeping, momentum unloads)'],
  integrator: 'Adams-Bashforth-Moulton (PECE, order 8, fixed step set from the periapsis angular rate and the gravity '
    + 'degree), started by Gragg-Bulirsch-Stoer; Gragg-Bulirsch-Stoer with step and order control (Hairer, Norsett & '
    + 'Wanner, relative tolerance 1e-12) is the reference integrator in the checks and is selectable',
  degreeRule: DEGREE_RULE
};

return {
  init: init, start: start, propagate: propagate, at: at, info: info,
  defaultDegree: defaultDegree, periapsisAltitude: periapsisAltitude, hScaleFor: hScaleFor, outputStep: function (r, v, km) { return outputStep(r, v, km || 0.005); },
  // exposed for tests
  _fieldAccel: function (x, N, out) { return fieldAccel(x, N, out || [0, 0, 0]); }, _fieldPotential: fieldPotential,
  _ephemAt: function (ms, pa) { return ephemAt(ms, pa !== false, new Float64Array(15)); }, _mePa: function () { return MEPA; },
  _EphGrid: EphGrid, _setRule: function (rule) { DEGREE_RULE = rule; info.degreeRule = rule; }
};
});
