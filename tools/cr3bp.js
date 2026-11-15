// Solve CR3BP periodic orbits (southern L2 9:2-type NRHO and a ~70,000 km DRO) for embedding.
const MU = 0.012150585;            // Earth-Moon mass ratio
const LU = 384400;                 // km
const TU = 27.321661 * 86400 / (2 * Math.PI); // s per nondim time unit (sidereal month / 2pi)

function deriv(t, s) {
  const [x, y, z, vx, vy, vz] = s;
  const r1 = Math.hypot(x + MU, y, z), r2 = Math.hypot(x - 1 + MU, y, z);
  const r13 = r1 ** 3, r23 = r2 ** 3, r15 = r1 ** 5, r25 = r2 ** 5;
  const ax = 2 * vy + x - (1 - MU) * (x + MU) / r13 - MU * (x - 1 + MU) / r23;
  const ay = -2 * vx + y - (1 - MU) * y / r13 - MU * y / r23;
  const az = -(1 - MU) * z / r13 - MU * z / r23;
  const out = [vx, vy, vz, ax, ay, az];
  if (s.length > 6) {
    // second partials of U
    const Uxx = 1 - (1 - MU) / r13 - MU / r23 + 3 * (1 - MU) * (x + MU) ** 2 / r15 + 3 * MU * (x - 1 + MU) ** 2 / r25;
    const Uyy = 1 - (1 - MU) / r13 - MU / r23 + 3 * (1 - MU) * y * y / r15 + 3 * MU * y * y / r25;
    const Uzz = -(1 - MU) / r13 - MU / r23 + 3 * (1 - MU) * z * z / r15 + 3 * MU * z * z / r25;
    const Uxy = 3 * (1 - MU) * (x + MU) * y / r15 + 3 * MU * (x - 1 + MU) * y / r25;
    const Uxz = 3 * (1 - MU) * (x + MU) * z / r15 + 3 * MU * (x - 1 + MU) * z / r25;
    const Uyz = 3 * (1 - MU) * y * z / r15 + 3 * MU * y * z / r25;
    const A = [
      [0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1],
      [Uxx, Uxy, Uxz, 0, 2, 0], [Uxy, Uyy, Uyz, -2, 0, 0], [Uxz, Uyz, Uzz, 0, 0, 0]];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let v = 0; for (let k = 0; k < 6; k++) v += A[i][k] * s[6 + k * 6 + j];
      out.push(v);
    }
  }
  return out;
}
function add(a, b, h) { return a.map((v, i) => v + h * b[i]); }
// Dormand-Prince 5(4) with dense stop at y=0 crossing (after tmin)
function propagate(s0, opts) {
  const { tmax = 10, tmin = 0.05, stopAtY0 = false, tol = 1e-12, record = false } = opts;
  let t = 0, s = s0.slice(), h = 1e-4;
  const c = [0, 1/5, 3/10, 4/5, 8/9, 1, 1];
  const a = [[], [1/5], [3/40, 9/40], [44/45, -56/15, 32/9], [19372/6561, -25360/2187, 64448/6561, -212/729],
    [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656], [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]];
  const b5 = [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84, 0];
  const b4 = [5179/57600, 0, 7571/16695, 393/640, -92097/339200, 187/2100, 1/40];
  const rec = record ? [{ t, s: s.slice(0, 6) }] : null;
  for (let it = 0; it < 2e6 && t < tmax; it++) {
    if (t + h > tmax) h = tmax - t;
    const k = [];
    for (let i = 0; i < 7; i++) {
      let si = s.slice();
      for (let j = 0; j < i; j++) si = add(si, k[j], h * a[i][j]);
      k.push(deriv(t + c[i] * h, si));
    }
    let s5 = s.slice(), s4 = s.slice();
    for (let i = 0; i < 7; i++) { s5 = add(s5, k[i], h * b5[i]); s4 = add(s4, k[i], h * b4[i]); }
    let err = 0; for (let i = 0; i < 6; i++) err = Math.max(err, Math.abs(s5[i] - s4[i]) / (1 + Math.abs(s5[i])));
    if (err > tol && h > 1e-12) { h *= Math.max(0.1, 0.9 * Math.pow(tol / err, 0.2)); continue; }
    if (stopAtY0 && t + h > tmin && Math.sign(s[1]) !== Math.sign(s5[1]) && s[1] !== 0) {
      // refine crossing with Newton on y using bisection-ish halving of h
      let lo = 0, hi = h;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        const sm = stepTo(s, t, mid);
        if (Math.sign(sm[1]) === Math.sign(s[1])) lo = mid; else hi = mid;
      }
      const sf = stepTo(s, t, hi);
      return { t: t + hi, s: sf, rec };
    }
    t += h; s = s5;
    if (record) rec.push({ t, s: s.slice(0, 6) });
    h *= Math.min(4, 0.9 * Math.pow(tol / Math.max(err, 1e-30), 0.2));
  }
  return { t, s, rec };
}
function stepTo(s, t, H) { // accurate sub-step via fixed RK4 substeps
  const n = 200, h = H / n; let x = s.slice(), tt = t;
  for (let i = 0; i < n; i++) {
    const k1 = deriv(tt, x), k2 = deriv(tt + h / 2, add(x, k1, h / 2)), k3 = deriv(tt + h / 2, add(x, k2, h / 2)), k4 = deriv(tt + h, add(x, k3, h));
    x = x.map((v, j) => v + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])); tt += h;
  }
  return x;
}
function withSTM(s6) { const I = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) I.push(i === j ? 1 : 0); return s6.concat(I); }

// Symmetric 3D orbit: fix z0, vary x0 and vy0 to get vx=vz=0 at half period
function correct3D(x0, z0, vy0) {
  for (let it = 0; it < 40; it++) {
    const r = propagate(withSTM([x0, 0, z0, 0, vy0, 0]), { stopAtY0: true, tmin: 0.2 });
    const s = r.s, P = (i, j) => s[6 + i * 6 + j];
    const d = deriv(0, s.slice(0, 6));
    const vx = s[3], vz = s[5], vy = s[4];
    if (Math.abs(vx) < 1e-11 && Math.abs(vz) < 1e-11) return { x0, z0, vy0, T: 2 * r.t };
    const M = [[P(3, 0) - d[3] / vy * P(1, 0), P(3, 4) - d[3] / vy * P(1, 4)],
               [P(5, 0) - d[5] / vy * P(1, 0), P(5, 4) - d[5] / vy * P(1, 4)]];
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    const dx = (-vx * M[1][1] + vz * M[0][1]) / det;
    const dv = (-vz * M[0][0] + vx * M[1][0]) / det;
    x0 += dx; vy0 += dv;
  }
  throw new Error('3D correction did not converge');
}
// Planar symmetric: fix x0, vary vy0 to get vx=0
function correctPlanar(x0, vy0) {
  for (let it = 0; it < 40; it++) {
    const r = propagate(withSTM([x0, 0, 0, 0, vy0, 0]), { stopAtY0: true, tmin: 0.01 });
    const s = r.s, P = (i, j) => s[6 + i * 6 + j];
    const d = deriv(0, s.slice(0, 6));
    const vx = s[3], vy = s[4];
    if (Math.abs(vx) < 1e-11) return { x0, vy0, T: 2 * r.t };
    const m = P(3, 4) - d[3] / vy * P(1, 4);
    vy0 -= vx / m;
  }
  throw new Error('planar correction did not converge');
}
function sample(s0, T, n) {
  const r = propagate(s0, { tmax: T, record: true, tol: 1e-12 });
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / n * T;
    while (k < r.rec.length - 2 && r.rec[k + 1].t < tt) k++;
    const A = r.rec[k], B = r.rec[k + 1], f = (tt - A.t) / (B.t - A.t || 1);
    out.push(A.s.map((v, j) => v + (B.s[j] - v) * f));
  }
  return { pts: out, end: r.s };
}

// ---- NRHO
const nrho = correct3D(1.0221, -0.1821, -0.1033);
const nrhoS = sample([nrho.x0, 0, nrho.z0, 0, nrho.vy0, 0], nrho.T, 1);
let rp = 1e9, ra = 0, rpz = 0;
const fine = propagate([nrho.x0, 0, nrho.z0, 0, nrho.vy0, 0], { tmax: nrho.T, record: true });
for (const p of fine.rec) { const d = Math.hypot(p.s[0] - 1 + MU, p.s[1], p.s[2]) * LU; if (d < rp) { rp = d; rpz = p.s[2]; } if (d > ra) ra = d; }
console.log('NRHO x0', nrho.x0, 'z0', nrho.z0, 'vy0', nrho.vy0, 'T days', (nrho.T * TU / 86400).toFixed(3), 'perilune r km', rp.toFixed(0), 'perilune z sign', Math.sign(rpz), 'apolune r km', ra.toFixed(0));
const closure = fine.s.slice(0, 6).map((v, i) => v - [nrho.x0, 0, nrho.z0, 0, nrho.vy0, 0][i]);
console.log('NRHO full-period closure', closure.map(v => v.toExponential(1)).join(' '));

// ---- DRO continuation from small radius
let vy = null, d0 = 0.02, dro;
for (let d = 0.02; d <= 0.1822; d += 0.01) {
  const x0 = 1 - MU + Math.min(d, 0.1821);
  const guess = vy === null ? -(Math.sqrt(MU / d) + d) : vy;
  dro = correctPlanar(x0, guess); vy = dro.vy0;
}
const droFine = propagate([dro.x0, 0, 0, 0, dro.vy0, 0], { tmax: dro.T, record: true });
let dmin = 1e9, dmax = 0, ymax = 0;
for (const p of droFine.rec) { const d = Math.hypot(p.s[0] - 1 + MU, p.s[1]) * LU; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); ymax = Math.max(ymax, Math.abs(p.s[1]) * LU); }
console.log('DRO x0', dro.x0, 'vy0', dro.vy0, 'T days', (dro.T * TU / 86400).toFixed(3), 'range km', dmin.toFixed(0), dmax.toFixed(0), 'max |y| km', ymax.toFixed(0));

// Embed: Moon-centred rotating-frame km, 360 samples each
function pack(x0, z0, vy0, T, n) {
  const fineRec = propagate([x0, 0, z0, 0, vy0, 0], { tmax: T, record: true }).rec;
  const pts = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / n * T;
    while (k < fineRec.length - 2 && fineRec[k + 1].t < tt) k++;
    const A = fineRec[k], B = fineRec[k + 1], f = (tt - A.t) / (B.t - A.t || 1);
    const p = A.s.map((v, j) => v + (B.s[j] - v) * f);
    pts.push([Math.round((p[0] - 1 + MU) * LU), Math.round(p[1] * LU), Math.round(p[2] * LU)]);
  }
  return { periodDays: +(T * TU / 86400).toFixed(5), pts };
}
// NRHO needs denser sampling near perilune; sample in time but with 2000 points
const out = { nrho: pack(nrho.x0, nrho.z0, nrho.vy0, nrho.T, 2000), dro: pack(dro.x0, 0, dro.vy0, dro.T, 360) };
require('fs').writeFileSync(process.argv[2], JSON.stringify(out));
console.log('wrote', process.argv[2]);
