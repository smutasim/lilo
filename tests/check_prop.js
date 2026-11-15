/* Validation of src/prop.js (orbit propagator) against JPL Horizons and SPICE.

   Inputs (tests/data, written by tools/sats/make_sats.py):
     truth_<sat>_<span>.json   Horizons vector tables (Moon centre, ICRF, km, km/s, hourly; 'acc': 20 s for 4 h),
                               times converted TDB -> UTC with SPICE
     gravity_ref.json          GRGM1200A to degree 150 (data/gravity.json is the same file cut to the shipped degree)
     spice_ref.json            SPICE Earth/Sun from the Moon and the J2000 -> MOON_PA rotation at 49 epochs
   Output: tests/out/check_prop.json. Exit code 1 if a check misses its threshold (thresholds at the bottom, set from
   the measured values of 2026-11-14 with margin; see docs/validation.md, sixth pass).

   node tests/check_prop.js            full run (accuracy vs degree, truncation, manoeuvre scan; a few minutes)
   node tests/check_prop.js --quick    unit checks, convergence and the default configuration only */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = require(path.join(ROOT, 'src', 'prop.js'));
const AE = require(path.join(ROOT, 'node_modules', 'astronomy-engine'));
const QUICK = process.argv.includes('--quick');
const TD = path.join(ROOT, 'tests', 'data');
const GREF = JSON.parse(fs.readFileSync(path.join(TD, 'gravity_ref.json')));
const GSHIP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'gravity.json')));
P.init(GREF, AE);
const H = 3600e3, D = 864e5;
const HORIZONS = [['1h', 1 * H], ['6h', 6 * H], ['1d', D], ['3d', 3 * D], ['7d', 7 * D], ['14d', 14 * D], ['30d', 30 * D]];
const SATS = ['lro', 'danuri', 'chandrayaan2', 'artemis_p1', 'artemis_p2', 'capstone'];
const BUILTIN = { lro: 1, danuri: 1, chandrayaan2: 1, artemis_p1: 1, artemis_p2: 1, capstone: 0 };
const out = { date: new Date().toISOString(), quick: QUICK, info: P.info, checks: {}, sats: {}, runs: {} };
const fails = [];
function check(name, value, limit, extra) {
  const ok = value <= limit;
  out.checks[name] = Object.assign({ value, limit, ok }, extra || {});
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + fmt(value) + ' (limit ' + fmt(limit) + ')');
  if (!ok) fails.push(name);
}
function fmt(x) { return typeof x === 'number' ? (Math.abs(x) >= 0.01 || x === 0 ? +x.toPrecision(4) : x.toExponential(2)) : String(x); }
const norm = v => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function truth(id, span) {
  const p = path.join(TD, `truth_${id}_${span}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : null;
}
const tr3 = (a, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];

/* ================= A. unit checks ================= */
console.log('== A. unit checks');
{ // A1: field acceleration = gradient of an independently computed potential (central differences, 1 m)
  let worst = 0;
  const pts = [[1200, -900, 1100], [0, 0, 1790], [1780, 50, -300], [-500, 1700, 200], [30, -20, -1785]];
  for (const N of [8, 60, 150]) for (const x of pts) {
    const a = P._fieldAccel(x, N), g = [];
    for (let k = 0; k < 3; k++) { const p = x.slice(), m = x.slice(); p[k] += 1e-3; m[k] -= 1e-3; g.push((P._fieldPotential(p, N) - P._fieldPotential(m, N)) / 2e-3); }
    worst = Math.max(worst, norm(sub(a, g)) / norm(a));
  }
  check('A1 field acceleration vs finite-difference gradient of the potential (relative)', worst, 1e-7);
}
const SP = JSON.parse(fs.readFileSync(path.join(TD, 'spice_ref.json')));
{ // A2: ME->PA matrix from the kernel angles vs SPICE pxform
  const M = P._mePa(); let d = 0;   // MEPA maps ME -> PA, SPICE gives PA -> ME: compare with the transpose
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) d = Math.max(d, Math.abs(M[i][j] - SP.pa_to_me[j][i]));
  check('A2 ME->PA rotation from moon_de440_250416.tf angles vs SPICE pxform (max element)', d, 1e-14);
}
{ // A3: astronomy-engine Earth, Sun and lunar PA orientation vs SPICE (DE440)
  let de = 0, ds = 0, dor = 0, dorMe = 0, dorRel = 0;
  for (const r of SP.rows) {
    const e = P._ephemAt(r.t_ms, true), e0 = P._ephemAt(r.t_ms, false);
    de = Math.max(de, norm(sub([e[0], e[1], e[2]], r.earth)));
    ds = Math.max(ds, norm(sub([e[3], e[4], e[5]], r.sun)));
    // rotation angle between our ICRF->PA matrix and SPICE's: angle of A_ours * A_spice^T
    const ang = (E) => { let tr = 0; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += E[6 + i * 3 + k] * r.icrf_to_pa[i][k]; return Math.acos(Math.min(1, (tr - 1) / 2)) * 180 / Math.PI; };
    dor = Math.max(dor, ang(e)); dorMe = Math.max(dorMe, ang(e0));
  }
  out.checks.A3_detail = { earth_km: de, sun_km: ds, pa_orientation_deg: dor, without_me_to_pa_deg: dorMe };
  check('A3a Earth from the Moon, astronomy-engine vs SPICE DE440 (km, 49 epochs 2023-2027)', de, 20);
  check('A3b Sun from the Moon, astronomy-engine vs SPICE DE440 (km)', ds, 2e4);
  check('A3c lunar PA orientation (IAU model + ME->PA) vs SPICE MOON_PA_DE440 (deg)', dor, 0.01, { without_me_to_pa_deg: dorMe });
}
{ // A4: the 1 h ephemeris grid with cubic interpolation vs direct evaluation
  const g = new P._EphGrid(Date.UTC(2026, 10, 14), Date.UTC(2026, 11, 14), true), o = new Float64Array(15);
  let dp = 0, dr = 0;
  for (let k = 0; k < 300; k++) {
    const ms = Date.UTC(2026, 10, 14) + (k + 0.37) * 2.31 * H, d = P._ephemAt(ms, true);
    g.at(ms, o);
    dp = Math.max(dp, norm(sub([o[0], o[1], o[2]], [d[0], d[1], d[2]])));
    for (let i = 6; i < 15; i++) dr = Math.max(dr, Math.abs(o[i] - d[i]));
  }
  out.checks.A4_detail = { earth_km: dp, matrix_element: dr };
  check('A4 ephemeris grid interpolation: Earth position (km)', dp, 1e-3);
  check('A4 ephemeris grid interpolation: rotation matrix element', dr, 1e-9);
}
{ // A5: the shipped field equals the reference field to its degree
  let d = 0; for (let i = 0; i < GSHIP.C.length; i++) d = Math.max(d, Math.abs(GSHIP.C[i] - GREF.C[i]), Math.abs(GSHIP.S[i] - GREF.S[i]));
  check('A5 data/gravity.json coefficients equal tests/data/gravity_ref.json (max abs difference)', d, 0, { degree: GSHIP.degree });
}

/* ================= helpers ================= */
function run(id, span, o, extendMs) {
  const t = truth(id, span);
  const base = { r: tr3(t.r, 0), v: tr3(t.v, 0), epochMs: t.t_ms[0], t0Ms: t.t_ms[0] - 6 * H, t1Ms: t.t_ms[t.n - 1] + (extendMs || 6 * H) };
  const w0 = Date.now(), res = P.propagate(Object.assign(base, o)), wall = Date.now() - w0;
  res.wall = wall; res.days = (base.t1Ms - base.t0Ms) / D; res.wallPer30d = wall / res.days * 30;
  return res;
}
/* error of a propagation against the truth at row i */
function errAt(res, t, i) {
  const s = P.at(res, t.t_ms[i]); if (!s) return null;
  const rt = tr3(t.r, i), vt = tr3(t.v, i), d = sub(s.p, rt), vn = norm(vt);
  // timing: tau with r_prop(t + tau) closest to r_truth(t) (Newton on d . v)
  let tau = 0, ok = false, q = s;
  for (let k = 0; k < 30; k++) {
    q = P.at(res, t.t_ms[i] + tau * 1000); if (!q) break;
    const dd = sub(q.p, rt), step = -dot(dd, q.v) / dot(q.v, q.v);
    tau += step; if (Math.abs(step) < 1e-4) { ok = true; break; }
  }
  if (ok) q = P.at(res, t.t_ms[i] + tau * 1000);
  return { pos_km: norm(d), along_km: dot(d, vt) / vn, late_s: ok && q ? tau : null, resid_km: ok && q ? norm(sub(q.p, rt)) : null };
}
function table(res, t) {
  const o = {};
  for (const [lab, dt] of HORIZONS) {
    const i = Math.round(dt / H); if (i >= t.n) break;
    const e = errAt(res, t, i); if (e) o[lab] = e;
  }
  return o;
}
function fmtRow(tab) { return Object.entries(tab).map(([k, e]) => k + ' ' + e.pos_km.toFixed(3) + (e.late_s === null ? '' : '/' + e.late_s.toFixed(2) + 's')).join('  '); }
/* largest error in each day, to see where the truth departs (manoeuvres) */
function daily(res, t) {
  const o = [];
  for (let i = 0; i < t.n; i++) { const e = errAt(res, t, i); if (!e) continue; const d = Math.floor((t.t_ms[i] - t.t_ms[0]) / D); o[d] = Math.max(o[d] || 0, e.pos_km); }
  return o.map(x => +x.toFixed(3));
}
/* angle (deg) between the propagated and true directions as seen from the lunar south pole (on a 1737.4 km sphere,
   IAU pole), at rows where the true satellite is above the pole's horizontal plane; max per day */
function poleDir(res, t) {
  const o = [];
  for (let i = 0; i < t.n; i++) {
    const ms = t.t_ms[i], s = P.at(res, ms); if (!s) continue;
    const e = P._ephemAt(ms, false), z = [e[12], e[13], e[14]], site = z.map(x => -1737.4 * x);
    const a = sub(tr3(t.r, i), site), b = sub(s.p, site);
    if (dot(a, z.map(x => -x)) <= 0) continue;   // below the pole's horizontal plane
    const ang = Math.acos(Math.min(1, dot(a, b) / (norm(a) * norm(b)))) * 180 / Math.PI, d = Math.floor((ms - t.t_ms[0]) / D);
    o[d] = Math.max(o[d] || 0, ang);
  }
  return Array.from(o, x => x === undefined ? null : +x.toFixed(4));
}
const DEF = {};
for (const id of SATS) {
  const t = truth(id, BUILTIN[id] ? 'now' : 'fit');
  DEF[id] = P.defaultDegree(tr3(t.r, 0), tr3(t.v, 0));
}
out.default_degrees = DEF;

/* ================= B. integrator convergence (default configuration, 7 days) ================= */
console.log('== B. integrator convergence');
out.convergence = {};
for (const id of SATS) {
  const span = BUILTIN[id] ? 'now' : 'fit', t = truth(id, span), N = DEF[id];
  const o = { r: tr3(t.r, 0), v: tr3(t.v, 0), epochMs: t.t_ms[0], t0Ms: t.t_ms[0], t1Ms: t.t_ms[0] + 7 * D, degree: N };
  const a = P.propagate(o), hs = P.hScaleFor(N);
  const b = P.propagate(Object.assign({}, o, { hScale: hs / 2 }));
  const c = P.propagate(Object.assign({}, o, { integrator: 'gbs', tol: 1e-13 }));
  let dh = 0, dg = 0;
  for (let i = 0; i < a.n; i++) { dh = Math.max(dh, norm(sub(tr3(a.p, i), tr3(b.p, i)))); dg = Math.max(dg, norm(sub(tr3(a.p, i), tr3(c.p, i)))); }
  out.convergence[id] = { degree: N, h_s: a.hSec, output_step_s: a.stepMs / 1000, half_step_max_km: dh, gbs_1e13_max_km: dg, evals_per_day: a.evals / 7 };
  console.log(`  ${id.padEnd(13)} N ${N}  h ${a.hSec.toFixed(1)} s  out ${a.stepMs / 1000} s  |h - h/2| ${dh.toExponential(2)} km  |ABM - GBS 1e-13| ${dg.toExponential(2)} km`);
  check(`B ${id} integration error over 7 d vs Bulirsch-Stoer 1e-13 (km)`, dg, 0.01);
}
/* ================= C. output interpolation (cubic Hermite on the output grid) ================= */
console.log('== C. Hermite interpolation of the output grid');
out.interp = {};
for (const id of SATS) {
  const span = BUILTIN[id] ? 'now' : 'fit', t = truth(id, span), N = DEF[id];
  const o = { r: tr3(t.r, 0), v: tr3(t.v, 0), epochMs: t.t_ms[0], t0Ms: t.t_ms[0], t1Ms: t.t_ms[0] + 2 * D, degree: N, integrator: 'gbs', tol: 1e-13 };
  const a = P.propagate(o), b = P.propagate(Object.assign({}, o, { stepMs: a.stepMs / 2 }));
  let m = 0;
  for (let i = 1; i < b.n - 1; i += 2) m = Math.max(m, norm(sub(P.at(a, b.t0 + i * b.stepMs).p, tr3(b.p, i))));
  out.interp[id] = { output_step_s: a.stepMs / 1000, max_midpoint_km: m };
  console.log(`  ${id.padEnd(13)} step ${a.stepMs / 1000} s  max error at mid-step ${(m * 1000).toFixed(2)} m`);
  check(`C ${id} Hermite interpolation at mid-step (km)`, m, 0.01);
}
/* ================= D. backward propagation ================= */
console.log('== D. backward propagation and round trip');
out.backward = {};
for (const id of ['lro', 'chandrayaan2', 'artemis_p1']) {
  const t = truth(id, 'now'), k = 168, N = DEF[id];
  const o = { r: tr3(t.r, k), v: tr3(t.v, k), epochMs: t.t_ms[k], t0Ms: t.t_ms[0] - H, t1Ms: t.t_ms[k] + H, degree: N };
  const res = P.propagate(o), row = {};
  for (const [lab, back] of [['-1d', 24], ['-3d', 72], ['-7d', 168]]) row[lab] = errAt(res, t, k - back);
  const fw = P.propagate({ r: tr3(t.r, 0), v: tr3(t.v, 0), epochMs: t.t_ms[0], t0Ms: t.t_ms[0], t1Ms: t.t_ms[k], degree: N, stepMs: res.stepMs });
  const j = fw.n - 1, bk = P.propagate({ r: tr3(fw.p, j), v: tr3(fw.v, j), epochMs: fw.t0 + j * fw.stepMs, t0Ms: t.t_ms[0], t1Ms: fw.t0 + j * fw.stepMs, degree: N, stepMs: res.stepMs });
  const trip = norm(sub(tr3(bk.p, 0), tr3(t.r, 0)));
  out.backward[id] = { degree: N, vs_truth: row, round_trip_7d_km: trip };
  console.log(`  ${id.padEnd(13)} from day 7 back: ` + Object.entries(row).map(([l, e]) => l + ' ' + e.pos_km.toFixed(3) + ' km').join('  ') + `   forward 7 d then back: ${(trip * 1000).toFixed(2)} m`);
  check(`D ${id} round trip 7 d forward and back (km)`, trip, 0.01);
}

/* ================= E/F. accuracy vs Horizons, degree, ablations ================= */
console.log('== E. accuracy against Horizons');
const DEGS = QUICK ? [] : [2, 4, 8, 12, 16, 20, 30, 40, 50, 60, 80, 100];
out.accuracy = {};
for (const id of SATS) {
  out.accuracy[id] = {};
  for (const span of ['now', 'fit']) {
    const t = truth(id, span); if (!t) continue;
    const R = out.accuracy[id][span] = { start_utc: new Date(t.t_ms[0]).toISOString(), end_utc: new Date(t.t_ms[t.n - 1]).toISOString(), source: t.header.source, configs: {} };
    const cfgs = [['two-body', { twoBody: true }], ['default N=' + DEF[id], { degree: DEF[id] }]];
    if (!QUICK) {
      cfgs.push(['default, no third bodies', { degree: DEF[id], thirdBodies: false }], ['default, ME axes (no ME->PA)', { degree: DEF[id], pa: false }]);
      for (const N of DEGS) cfgs.push(['N=' + N, { degree: N }]);
    }
    const runs = {};
    for (const [name, o] of cfgs) {
      const res = run(id, span, o);
      runs[name] = res;
      R.configs[name] = { degree: res.degree, wall_ms_per_30d: Math.round(res.wallPer30d), evals_per_day: Math.round(res.evals / res.days), errors: table(res, t) };
      console.log(`  ${id.padEnd(13)} ${span} ${name.padEnd(30)} ${fmtRow(R.configs[name].errors)}   ${(res.wallPer30d / 1000).toFixed(2)} s/30d`);
    }
    const dk = 'default N=' + DEF[id];
    R.daily_max_km_default = daily(runs[dk], t);
    R.pole_direction_deg_daily_max_default = poleDir(runs[dk], t);
    // altitude range over the propagated span (default)
    let lo = 1e9, hi = 0; const rd = runs[dk];
    for (let i = 0; i < rd.n; i++) { const a = norm(tr3(rd.p, i)) - 1737.4; lo = Math.min(lo, a); hi = Math.max(hi, a); }
    R.alt_range_km = [+lo.toFixed(1), +hi.toFixed(1)];
    // truncation: each degree against N = 100 (same force model otherwise)
    if (!QUICK) {
      const ref = runs['N=100'], tr = {};
      for (const N of DEGS) if (N !== 100) {
        const a = runs['N=' + N], row = {};
        for (const [lab, dt] of HORIZONS) {
          const ms = t.t_ms[0] + dt; if (ms > t.t_ms[t.n - 1]) break;
          const p = P.at(a, ms), q = P.at(ref, ms), v = q.v, d = sub(p.p, q.p);
          row[lab] = { pos_km: +norm(d).toFixed(4), late_s: +(-dot(d, v) / dot(v, v)).toFixed(3) };
        }
        tr['N=' + N] = row;
      }
      R.truncation_vs_N100 = tr;
    }
  }
}

/* ================= G. manoeuvre scan: one-hour arcs from every truth row ================= */
out.arcs = {};
if (!QUICK) {
  console.log('== G. one-hour arcs from each Horizons row (departures from ballistic motion)');
  for (const id of SATS) for (const span of ['now', 'fit']) {
    const t = truth(id, span); if (!t) continue;
    const N = Math.min(DEF[id], 30), rs = [];
    for (let i = 0; i + 1 < t.n; i++) {
      const res = P.propagate({ r: tr3(t.r, i), v: tr3(t.v, i), epochMs: t.t_ms[i], t0Ms: t.t_ms[i], t1Ms: t.t_ms[i + 1], degree: N, stepMs: t.t_ms[i + 1] - t.t_ms[i], integrator: 'gbs', tol: 1e-11 });
      const k = res.n - 1;
      rs.push([i, norm(sub(tr3(res.p, k), tr3(t.r, i + 1))), norm(sub(tr3(res.v, k), tr3(t.v, i + 1)))]);
    }
    const s = rs.map(x => x[1]).sort((a, b) => a - b), med = s[s.length >> 1], p90 = s[Math.floor(s.length * 0.9)];
    const flag = rs.filter(x => x[1] > Math.max(10 * med, 0.3)).map(x => ({ utc: new Date(t.t_ms[x[0]]).toISOString(), resid_km: +x[1].toFixed(3), dv_m_s: +(x[2] * 1000).toFixed(2) }));
    out.arcs[id + '_' + span] = { degree: N, median_km: +med.toFixed(4), p90_km: +p90.toFixed(4), flagged: flag };
    console.log(`  ${id.padEnd(13)} ${span}  N ${N}  1-h arc residual median ${(med * 1000).toFixed(0)} m, p90 ${(p90 * 1000).toFixed(0)} m, flagged ${flag.length}` + (flag.length ? ': ' + flag.slice(0, 6).map(f => f.utc.slice(0, 16) + ' ' + f.resid_km + ' km').join(', ') + (flag.length > 6 ? ', ...' : '') : ''));
  }
}

/* ================= H. acceleration against Horizons (20 s tables, 4 h) ================= */
console.log('== H. model acceleration vs Horizons (five-point differences of Horizons velocities, 20 s)');
out.accel = {};
function modelAccel(ms, r, N) {
  const e = P._ephemAt(ms, true), xb = [0, 1, 2].map(j => e[6 + j * 3] * r[0] + e[7 + j * 3] * r[1] + e[8 + j * 3] * r[2]);
  const ab = P._fieldAccel(xb, N), a = [0, 1, 2].map(j => e[6 + j] * ab[0] + e[9 + j] * ab[1] + e[12 + j] * ab[2]);
  const rn = norm(r), gm = GREF.gm_km3_s2;
  for (let j = 0; j < 3; j++) a[j] -= gm * r[j] / rn ** 3;
  for (const [b, g] of [[0, P.info.thirdBodies.earth_gm_km3_s2], [1, P.info.thirdBodies.sun_gm_km3_s2]]) {
    const s = [e[b * 3], e[b * 3 + 1], e[b * 3 + 2]], d = sub(s, r), dn = norm(d), sn = norm(s);
    for (let j = 0; j < 3; j++) a[j] += g * (d[j] / dn ** 3 - s[j] / sn ** 3);
  }
  return { a, sun: [e[3], e[4], e[5]] };
}
for (const id of SATS) {
  const t = truth(id, 'acc'); if (!t) continue;
  const row = {};
  for (const N of [DEF[id], 100]) {
    const res = [], mean = [0, 0, 0]; let cosSun = 0;
    for (let i = 2; i + 2 < t.n; i++) {
      const dt = (t.t_ms[i + 1] - t.t_ms[i]) / 1000, v = k => tr3(t.v, k);
      const afd = [0, 1, 2].map(j => (-v(i + 2)[j] + 8 * v(i + 1)[j] - 8 * v(i - 1)[j] + v(i - 2)[j]) / (12 * dt));
      const m = modelAccel(t.t_ms[i], tr3(t.r, i), N), d = sub(afd, m.a);
      res.push(norm(d) * 1e9); for (let j = 0; j < 3; j++) mean[j] += d[j] * 1e9 / (t.n - 4);
      cosSun = dot(mean, m.sun) / (norm(mean) * norm(m.sun));
    }
    res.sort((a, b) => a - b);
    row['N=' + N] = { median_um_s2: +res[res.length >> 1].toFixed(2), p90_um_s2: +res[Math.floor(res.length * 0.9)].toFixed(2), mean_vector_um_s2: +norm(mean).toFixed(2), mean_vector_cos_to_sun: +cosSun.toFixed(3) };
  }
  out.accel[id] = row;
  console.log(`  ${id.padEnd(13)} ` + Object.entries(row).map(([k, r]) => `${k}: median ${r.median_um_s2} p90 ${r.p90_um_s2} um/s^2, mean vector ${r.mean_vector_um_s2} (cos to Sun ${r.mean_vector_cos_to_sun})`).join('   '));
}

/* ================= summary for data/sats.json ================= */
out.error_definition = {
  pos_km: '|r_propagated(t) - r_Horizons(t)|, Moon-centred ICRF',
  along_km: 'component of that difference along the Horizons velocity (positive: propagated satellite ahead)',
  late_s: 'tau minimising |r_propagated(t + tau) - r_Horizons(t)|: the propagated satellite passes the true position tau seconds later (negative: earlier)',
  resid_km: 'the remaining (radial and cross-track) miss after that time shift'
};
for (const id of SATS) {
  const span = BUILTIN[id] ? 'now' : 'fit', A = out.accuracy[id][span];
  const arcs = out.arcs[id + '_' + span];
  out.sats[id] = {
    default_degree: DEF[id], span, alt_range_km: A.alt_range_km,
    default_errors: Object.fromEntries(Object.entries(A.configs['default N=' + DEF[id]].errors).map(([k, e]) => [k, { pos_km: +e.pos_km.toFixed(3), along_km: +e.along_km.toFixed(3), late_s: e.late_s === null ? null : +e.late_s.toFixed(2), resid_km: e.resid_km === null ? null : +e.resid_km.toFixed(3) }])),
    wall_ms_per_30d: A.configs['default N=' + DEF[id]].wall_ms_per_30d,
    note: arcs && arcs.flagged.length ? `Horizons trajectory departs from ballistic motion (1-h arc residual above ${Math.max(10 * arcs.median_km, 0.3).toFixed(2)} km) at ${arcs.flagged.length} hourly rows, first ${arcs.flagged[0].utc}` : null
  };
}

/* ================= regression thresholds (default configuration, 'now' span; set from the 2026-11-14 run) ================= */
const LIMITS = {   // km at 1 d, 3 d, 7 d
  lro: [0.3, 1.0, 2.0], chandrayaan2: [0.3, 0.5, 1.0], danuri: [6, 15, 40],
  artemis_p1: [0.3, 1.0, 3.0], artemis_p2: [0.3, 1.0, 3.0], capstone: [2, 15, 80]
};
console.log('== regression (default configuration)');
for (const id of SATS) {
  const e = out.sats[id].default_errors;
  ['1d', '3d', '7d'].forEach((k, j) => { if (e[k]) check(`R ${id} ${out.sats[id].span} ${k} position error (km)`, e[k].pos_km, LIMITS[id][j]); });
}
fs.mkdirSync(path.join(ROOT, 'tests', 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests', 'out', 'check_prop.json'), JSON.stringify(out, null, 1));
console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS');
process.exit(fails.length ? 1 : 0);
