/* ================= From Earth: the Moon and the landing site from a place on Earth ================= */
/* For the general public. The Moon is placed in the sky of the chosen observer (default Goldstone DSS-14) at the
   current time; an inset shows the disk as seen with binoculars, "up" toward the observer's zenith, with the
   phase, the libration of that moment and the landing site marked.
   Geometry (astronomy-engine): topocentric Moon and Sun vectors in the J2000 equator (EQJ) from GeoVector minus
   ObserverVector, turned into the observer's horizon frame by Rotation_EQJ_HOR (geodetic WGS 84 position). Lunar
   orientation: the IAU rotation model (LWB.aeAxes), the same one the page uses for satellites; the site is drawn
   from its ME coordinates (ME and the IAU frame differ by well under a kilometre, far below a pixel here).
   Atmosphere: refraction lifts the Moon by the Saemundsson formula (Meeus, Astronomical Algorithms, via
   astronomy-engine Refraction('normal')); this lift is reported. Sky colour, star fading, and the dimming and
   reddening near the horizon (air mass of Kasten and Young 1989 times illustrative per-colour extinction) are
   drawn for appearance only and enter no number. */
var FE = { cv: $('skyEarth'), key: '', geo: null, tex: null, disk: {}, cam: { yaw: 180, pitch: 20, hfov: 70, follow: 'moon' }, anim: null };
var FE_K = [0.12, 0.20, 0.33]; // illustrative extinction, magnitudes per air mass (R, G, B): display only
function feObs() { return new Astronomy.Observer(EOBS.lat, EOBS.lon, EOBS.h || 0); }
function v3(a) { return [a.x, a.y, a.z]; }
function feGeom(ms) {
  var k = Math.round(ms / 60000) + ':' + EOBS.lat + ':' + EOBS.lon + ':' + S.sel;
  if (FE.geo && FE.geo.k === k) return FE.geo;
  var time = Astronomy.MakeTime(new Date(ms)), ob = feObs(), R = Astronomy.Rotation_EQJ_HOR(time, ob);
  function hor(v) { var r = Astronomy.RotateVector(R, new Astronomy.Vector(v[0], v[1], v[2], time)); return [-r.y, r.x, r.z]; } // HOR (N, W, up) -> ENU
  var obsV = v3(Astronomy.ObserverVector(time, ob, false)), moonG = v3(Astronomy.GeoVector(Astronomy.Body.Moon, time, true)), sunG = v3(Astronomy.GeoVector(Astronomy.Body.Sun, time, true));
  var mT = hor(sub(moonG, obsV)), sT = hor(sub(sunG, obsV)), sM = unit(hor(sub(sunG, moonG))), ax = LWB.aeAxes(time);
  var aX = hor(ax.x), aY = hor(ax.y), aZ = hor(ax.z);
  function altaz(v) { var l = Math.hypot(v[0], v[1], v[2]), alt = Math.asin(v[2] / l) * R2D; return { az: (Math.atan2(v[0], v[1]) * R2D + 360) % 360, alt: alt, app: alt + Astronomy.Refraction('normal', alt), dist: l * AU }; }
  var M = altaz(mT), Sn = altaz(sT), f = unit(mT);
  var phaseAng = Math.acos(clamp(dot(sM, scl(f, -1)), -1, 1)), lit = (1 + Math.cos(phaseAng)) / 2, elong = Astronomy.MoonPhase(time);
  var site = SITES[S.sel], u = site.geo.u, p = unit([u[0] * aX[0] + u[1] * aY[0] + u[2] * aZ[0], u[0] * aX[1] + u[1] * aY[1] + u[2] * aZ[1], u[0] * aX[2] + u[1] * aY[2] + u[2] * aZ[2]]);
  var g = { k: k, ms: ms, M: M, Sn: Sn, f: f, sM: sM, aX: aX, aY: aY, aZ: aZ, lit: lit, waxing: elong < 180, elong: elong, site: p, siteUp: dot(p, scl(f, -1)) };
  g.siteLimb = Math.asin(clamp(g.siteUp, -1, 1)) * R2D; // angle of the site above (+) or beyond (-) the limb, seen from the Moon's centre
  g.moonRad = Math.asin(1737.4 / M.dist) * R2D;
  // next rise and set of the Moon for this observer (geometric centre with the standard refraction, astronomy-engine)
  try { var r = Astronomy.SearchRiseSet(Astronomy.Body.Moon, ob, +1, time, 2), s2 = Astronomy.SearchRiseSet(Astronomy.Body.Moon, ob, -1, time, 2); g.rise = r ? r.date.getTime() : null; g.set = s2 ? s2.date.getTime() : null; } catch (x) { g.rise = g.set = null; }
  FE.geo = g; return g;
}
function airmass(h) { return h <= -2 ? 40 : 1 / (Math.sin(Math.max(h, -1.9) * D2R) + 0.50572 * Math.pow(Math.max(h, -1.9) + 6.07995, -1.6364)); } // Kasten & Young 1989
function feTrans(h) { var X = airmass(h); return FE_K.map(function (k) { return Math.pow(10, -0.4 * k * (X - 1)); }); }
function phaseName(g) {
  var e = g.elong;
  if (e < 6 || e > 354) return 'new Moon'; if (Math.abs(e - 180) < 6) return 'full Moon';
  if (Math.abs(e - 90) < 6) return 'first quarter'; if (Math.abs(e - 270) < 6) return 'last quarter';
  return (g.waxing ? 'waxing ' : 'waning ') + (g.lit < 0.5 ? 'crescent' : 'gibbous');
}
/* Sky colour at the horizon and at the zenith for a Sun altitude h (degrees). Display only. */
function skyCols(h) {
  function mix(a, b, t) { t = clamp(t, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  var dayZ = [52, 112, 196], dayH = [166, 199, 232], twZ = [24, 38, 78], twH = [214, 140, 92], nZ = [3, 5, 12], nH = [10, 14, 26];
  if (h >= 8) return { z: dayZ, h: dayH, star: 0 };
  if (h >= -4) { var t = (h + 4) / 12; return { z: mix(twZ, dayZ, t), h: mix(twH, dayH, t), star: 0 }; }
  var t2 = (h + 18) / 14; return { z: mix(nZ, twZ, t2), h: mix(nH, twH, t2), star: clamp((-6 - h) / 10, 0, 1) };
}
function rgb(a, k) { k = k === undefined ? 1 : k; return 'rgb(' + Math.round(clamp(a[0] * k, 0, 255)) + ',' + Math.round(clamp(a[1] * k, 0, 255)) + ',' + Math.round(clamp(a[2] * k, 0, 255)) + ')'; }
function feTexture() {
  if (FE.tex || typeof globReady === 'undefined' || !globReady) return FE.tex;
  try { var c = document.createElement('canvas'); c.width = globImg.naturalWidth; c.height = globImg.naturalHeight; var x = c.getContext('2d'); x.drawImage(globImg, 0, 0); FE.tex = { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; } catch (e) { FE.tex = null; }
  return FE.tex;
}
/* The Moon's disk as seen through binoculars: LROC WAC mosaic on the visible hemisphere, lit by the Sun of the moment. */
function feMoonDisk(g, Rd, sky, trans, slot) {
  var key = g.k + ':' + Rd + ':' + Math.round(g.M.app * 4) + ':' + S.sel + ':' + (globReady ? 1 : 0) + ':' + sky.join(',');
  var D = FE.disk[slot] || (FE.disk[slot] = { cv: document.createElement('canvas'), key: '' }), cv = D.cv;
  if (D.key === key) return cv;
  var n = Rd * 2 + 2, T = feTexture(); cv.width = n; cv.height = n;
  var x = cv.getContext('2d'), img = x.createImageData(n, n), d = img.data, f = g.f, U = unit(sub([0, 0, 1], scl(f, f[2]))), Rt = cross(f, U);
  for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
    var nx = (i + 0.5 - n / 2) / Rd, ny = -(j + 0.5 - n / 2) / Rd, rr = nx * nx + ny * ny; if (rr > 1 + 2 / Rd) continue;
    var mu = Math.sqrt(Math.max(0, 1 - rr)), N = [nx * Rt[0] + ny * U[0] - mu * f[0], nx * Rt[1] + ny * U[1] - mu * f[1], nx * Rt[2] + ny * U[2] - mu * f[2]];
    var bx = dot(N, g.aX), by = dot(N, g.aY), bz = dot(N, g.aZ), lat = Math.asin(clamp(bz, -1, 1)) * R2D, lon = Math.atan2(by, bx) * R2D;
    var lam = dot(N, g.sM), k = lam > 0 ? 0.3 + 0.6 * Math.min(1, Math.sqrt(lam * 2.5)) : 0.03, c = [150, 150, 150];
    if (T) { var o = (Math.min(T.h - 1, Math.floor((90 - lat) / 180 * T.h)) * T.w + Math.min(T.w - 1, Math.floor((lon + 180) / 360 * T.w))) * 4; c = [T.d[o], T.d[o + 1], T.d[o + 2]]; }
    var q = (j * n + i) * 4, a = clamp((1 - Math.sqrt(rr)) * Rd + 0.5, 0, 1);
    for (var ch = 0; ch < 3; ch++) d[q + ch] = clamp(c[ch] * 1.35 * k * trans[ch] + sky[ch] * 0.22, 0, 255);
    d[q + 3] = Math.round(255 * a);
  }
  x.putImageData(img, 0, 0); D.key = key; return cv;
}
function renderFromEarth() {
  var cv = FE.cv, W = cv.clientWidth || 600, H = cv.clientHeight || 400, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (FE.anim) { FE.anim(performance.now()); requestAnimationFrame(kick); }
  var g = feGeom(S.tMs), M = g.M, Sn = g.Sn, sc = skyCols(Sn.app);
  // camera: follows the Moon (or the Sun) until the user drags; wide views keep the horizon low in the frame
  var K = FE.cam;
  if (K.follow && !FE.anim) { var tg = feTarget(K.follow, g); if (tg) { K.yaw = tg.az; K.pitch = tg.pitch; } }
  var yaw = K.yaw * D2R, pit = K.pitch * D2R, hf = K.hfov;
  var C = { f: [Math.sin(yaw) * Math.cos(pit), Math.cos(yaw) * Math.cos(pit), Math.sin(pit)], r: [Math.cos(yaw), -Math.sin(yaw), 0], F: (W / 2) / Math.tan(hf * D2R / 2), cx: W / 2, cy: H / 2, W: W, H: H };
  C.u = cross(C.r, C.f); FE.vhalf = Math.atan(Math.tan(hf * D2R / 2) * H / W) * R2D;
  // sky: vertical gradient from the horizon line up, plus a glow toward the Sun
  var hz = proj(C, dirAA(yaw, 0)), hy = hz ? hz[1] : H * 0.7, gr = c.createLinearGradient(0, 0, 0, hy);
  gr.addColorStop(0, rgb(sc.z)); gr.addColorStop(1, rgb(sc.h)); c.fillStyle = gr; c.fillRect(0, 0, W, H);
  var sp = Sn.app > -12 ? proj(C, dirAA(Sn.az * D2R, Sn.app * D2R)) : null;
  if (sp && Sn.app > -12) { var gl = c.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], W * 0.6); gl.addColorStop(0, 'rgba(255,225,180,' + (Sn.app > 0 ? 0.55 : 0.35 * (1 + Sn.app / 12)).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,225,180,0)'); c.fillStyle = gl; c.fillRect(0, 0, W, H); }
  // stars at night, J2000 directions turned into the horizon frame, dimmed toward the horizon
  if (sc.star > 0.02) {
    var time = Astronomy.MakeTime(new Date(S.tMs)), R = Astronomy.Rotation_EQJ_HOR(time, feObs()).rot;
    for (var i = 0; i < STAR.n; i++) {
      if (STAR.M[i] > 4.6) continue;
      var x = STAR.X[i], y = STAR.Y[i], z = STAR.Z[i], hx = R[0][0] * x + R[1][0] * y + R[2][0] * z, hy2 = R[0][1] * x + R[1][1] * y + R[2][1] * z, hzz = R[0][2] * x + R[1][2] * y + R[2][2] * z;
      if (hzz < 0.01) continue;
      var p = proj(C, [-hy2, hx, hzz]); if (!onScreen(p, C, 2)) continue;
      var al = clamp(1.2 - STAR.M[i] * 0.22, 0.1, 1) * sc.star * feTrans(Math.asin(hzz) * R2D)[1];
      c.globalAlpha = al; c.fillStyle = STAR.C[i]; var rd = Math.max(0.5, 1.9 - 0.3 * STAR.M[i]); c.fillRect(p[0] - rd / 2, p[1] - rd / 2, rd, rd);
    }
    c.globalAlpha = 1;
  }
  // the Sun, if in frame and up
  if (sp && Sn.app > -0.3) { var tS = feTrans(Sn.app); c.fillStyle = rgb([255, 255 * tS[1] / tS[0], 235 * tS[2] / tS[0]]); c.beginPath(); c.arc(sp[0], sp[1], Math.max(4, C.F * Math.tan(0.267 * D2R)), 0, 6.2832); c.fill(); }
  // the Moon at its apparent (refracted) place, true size, tinted by the air it shines through
  var mp = proj(C, dirAA(M.az * D2R, M.app * D2R)), tr = feTrans(M.app), mR = Math.max(3.5, C.F * Math.tan(g.moonRad * D2R));
  var skyAtMoon = M.app > 0 ? (Sn.app > -6 ? sc.h.map(function (v, k) { return v * 0.55 + sc.z[k] * 0.45; }) : [6, 8, 14]) : [6, 8, 14];
  if (onScreen(mp, C, mR + 4)) {
    if (mR >= 10) { // zoomed in: the textured, lit disk at true size (the same picture as the inset)
      var Rq = Math.min(320, Math.round(mR / 8) * 8 || 8), md = feMoonDisk(g, Rq, M.app > 0 && Sn.app > -6 ? skyAtMoon.map(function (v) { return v * 0.6; }) : [0, 0, 0], tr.map(function (v) { return Math.max(v, 0.08); }), 'scene'), k2 = mR / Rq;
      c.drawImage(md, mp[0] - md.width / 2 * k2, mp[1] - md.height / 2 * k2, md.width * k2, md.height * k2);
    } else {
      var lumM = 0.35 + 0.65 * g.lit;
      c.fillStyle = 'rgba(' + Math.round(240 * tr[0] * lumM) + ',' + Math.round(236 * tr[1] * lumM) + ',' + Math.round(222 * tr[2] * lumM) + ',1)';
      c.beginPath(); c.arc(mp[0], mp[1], mR, 0, 6.2832); c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1; c.beginPath(); c.arc(mp[0], mp[1], mR + 7, 0, 6.2832); c.stroke();
    c.font = '600 11px "Segoe UI", Arial, sans-serif'; c.fillStyle = M.app > 0 ? '#fff' : 'rgba(255,255,255,.7)'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(M.app > 0 ? 'Moon' : 'Moon (below the horizon)', mp[0] + mR + 11, mp[1]);
  }
  var moonOff = !onScreen(mp, C, mR + 4);
  // ground
  var day = clamp((Sn.app + 6) / 14, 0, 1), gcol = [18 + 40 * day, 20 + 44 * day, 18 + 30 * day];
  // basic terrain: a flat horizon (a level plain all round), so everything below 0 deg is ground
  var hyz = feHorizonY(C);
  if (hyz !== null) { var gg = c.createLinearGradient(0, Math.max(0, hyz), 0, H); gg.addColorStop(0, rgb(gcol)); gg.addColorStop(1, rgb(gcol, 0.55)); c.fillStyle = gg; c.fillRect(0, Math.max(0, hyz), W, H - Math.max(0, hyz)); c.strokeStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.moveTo(0, hyz + 0.5); c.lineTo(W, hyz + 0.5); c.stroke(); }
  else if (K.pitch < 0) { c.fillStyle = rgb(gcol); c.fillRect(0, 0, W, H); }
  drawCompass(c, C);
  if (!moonOff && M.app < 0) { // in frame but under the ground: show where it is
    c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.beginPath(); c.arc(mp[0], mp[1], mR + 7, 0, 6.2832); c.stroke(); c.setLineDash([]);
    c.font = '600 11px "Segoe UI", Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,.8)'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('Moon (below the horizon)', mp[0] + mR + 11, mp[1]);
  }
  if (moonOff) feEdgeArrow(c, C, dirAA(M.az * D2R, M.app * D2R), M.app > 0 ? 'Moon' : 'Moon (below the horizon)');
  // inset: the disk through binoculars
  var Rd = Math.round(clamp(Math.min(H * 0.3, W * 0.2), 40, 140)), bx = W - Rd * 2 - 26, by = 14, bw = Rd * 2 + 16, bh = Rd * 2 + 40;
  c.fillStyle = 'rgba(6,10,18,.72)'; c.fillRect(bx - 8, by - 6, bw, bh); c.strokeStyle = 'rgba(255,255,255,.25)'; c.strokeRect(bx - 8 + 0.5, by - 6 + 0.5, bw - 1, bh - 1);
  c.fillStyle = rgb(skyAtMoon); c.beginPath(); c.arc(bx + Rd, by + Rd + 2, Rd + 4, 0, 6.2832); c.fill();
  // binoculars gather light: keep the colour shift of the air but not most of its dimming, so the disk stays readable low down
  var tint = M.app > 0 ? [1, Math.sqrt(tr[1] / tr[0]), Math.sqrt(tr[2] / tr[0])].map(function (v) { return v * (0.55 + 0.45 * tr[0]); }) : [1, 1, 1];
  var mc = feMoonDisk(g, Rd, M.app > 0 && Sn.app > -6 ? skyAtMoon : [0, 0, 0], tint, 'inset');
  c.drawImage(mc, bx + Rd - mc.width / 2, by + Rd + 2 - mc.height / 2);
  // the landing site on the disk (or where it is, just past the limb)
  var f = g.f, U = unit(sub([0, 0, 1], scl(f, f[2]))), Rt = cross(f, U), sx = dot(g.site, Rt), sy = dot(g.site, U), cxm = bx + Rd, cym = by + Rd + 2;
  var ln = Math.hypot(sx, sy) || 1, onDisk = g.siteUp > 0, px2 = cxm + (onDisk ? sx : sx / ln) * Rd, py2 = cym - (onDisk ? sy : sy / ln) * Rd;
  c.strokeStyle = onDisk ? '#FFD34D' : 'rgba(255,211,77,.75)'; c.lineWidth = 2; if (!onDisk) c.setLineDash([3, 3]);
  c.beginPath(); c.arc(px2, py2, 6, 0, 6.2832); c.stroke(); c.setLineDash([]);
  c.font = '600 11px "Segoe UI", Arial, sans-serif'; c.fillStyle = '#FFD34D'; c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText(onDisk ? 'Landing site' : 'Landing site, just past the edge', cxm, by + Rd * 2 + 12);
  c.font = '10px "Segoe UI", Arial, sans-serif'; c.fillStyle = 'rgba(230,235,240,.75)'; c.textBaseline = 'top'; c.fillText('Through binoculars · up = overhead', cxm, by - 2);
  // lunar south pole tick, for orientation
  var spx = -g.aZ[0], spy = -g.aZ[1], spz = -g.aZ[2], sv = [spx, spy, spz];
  if (dot(sv, scl(f, -1)) > -0.05) { var qx = cxm + dot(sv, Rt) * Rd, qy = cym - dot(sv, U) * Rd; c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '10px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle'; c.fillText('S pole', qx + (qx < cxm ? -22 : 22), qy + (qy > cym ? 8 : -8)); }
  feText(g);
}
/* The camera has no roll, so the level horizon is a horizontal line on screen: its height from the camera pitch. */
function feHorizonY(C) { var p = proj(C, dirAA(FE.cam.yaw * D2R, 0)); return p ? p[1] : null; }
/* A body outside the frame: an arrow on the edge pointing to it. */
function feEdgeArrow(c, C, v, name) {
  var x = dot(v, C.r), y = dot(v, C.u), z = dot(v, C.f), a = Math.atan2(-y, x);
  if (z > 0 && Math.abs(x / z) * C.F < C.W / 2 && Math.abs(y / z) * C.F < C.H / 2) return;
  var cx = C.W / 2, cy = C.H / 2, dx = Math.cos(a), dy = Math.sin(a), t = Math.min((C.W / 2 - 30) / Math.abs(dx || 1e-9), (C.H / 2 - (dy > 0 ? 70 : 24)) / Math.abs(dy || 1e-9)), px = cx + dx * t, py = cy + dy * t;
  c.save(); c.translate(px, py); c.rotate(a); c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.moveTo(12, 0); c.lineTo(-4, -7); c.lineTo(-4, 7); c.closePath(); c.fill(); c.restore();
  c.font = '600 11px "Segoe UI", Arial, sans-serif'; c.fillStyle = '#fff'; c.textAlign = dx > 0.3 ? 'right' : dx < -0.3 ? 'left' : 'center'; c.textBaseline = dy > 0.3 ? 'bottom' : 'top';
  c.fillText(name, px - dx * 18, py - dy * 18);
}
/* Where "Look at" points: centred on the body when zoomed in; in wide views the horizon stays low in the frame. */
function feTarget(k, g) {
  var b = k === 'sun' ? g.Sn : g.M, hf = FE.cam.hfov;
  var vh = FE.vhalf || hf * 0.33; // half the vertical field of view at the last render
  return { az: b.az, pitch: hf < 30 ? clamp(b.app, -20, 89) : b.app < 0 ? 8 : clamp(Math.max(vh * 0.6, b.app - vh * 0.7), -20, 89) };
}
function feLook(k, hfov) {
  var g = feGeom(S.tMs), K = FE.cam, from = { yaw: K.yaw, pitch: K.pitch, hfov: K.hfov }, to;
  if (hfov) K.hfov = hfov; to = k === 'wide' ? { az: K.yaw, pitch: 15 } : feTarget(k, g); K.hfov = from.hfov;
  var tgt = { yaw: to.az, pitch: to.pitch, hfov: hfov || K.hfov }, dyaw = ((tgt.yaw - from.yaw + 540) % 360) - 180, t0 = performance.now();
  K.follow = k === 'moon' || k === 'sun' ? k : null; feFollowUI();
  FE.anim = function (now) {
    var u = clamp((now - t0) / 550, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    K.yaw = (from.yaw + dyaw * e + 360) % 360; K.pitch = from.pitch + (tgt.pitch - from.pitch) * e; K.hfov = Math.exp(Math.log(from.hfov) + (Math.log(tgt.hfov) - Math.log(from.hfov)) * e);
    if (u >= 1) FE.anim = null;
  };
  kick();
}
function feFollowUI() { Array.prototype.forEach.call(document.querySelectorAll('#feLook button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-fe') === FE.cam.follow ? 'true' : 'false'); }); }
function feZoom(f) { FE.cam.hfov = clamp(FE.cam.hfov * f, 0.6, 120); kick(); }
(function () {
  var cv = FE.cv, pts = {}, lastD = 0;
  cv.addEventListener('pointerdown', function (e) { pts[e.pointerId] = [e.clientX, e.clientY]; try { cv.setPointerCapture(e.pointerId); } catch (x) {} FE.anim = null; if (e.pointerType === 'mouse') cv.focus({ preventScroll: true }); });
  cv.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    var ids = Object.keys(pts);
    if (ids.length === 2) { pts[e.pointerId] = [e.clientX, e.clientY]; var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (lastD) FE.cam.hfov = clamp(FE.cam.hfov * lastD / d, 0.6, 120); lastD = d; kick(); return; }
    var p = pts[e.pointerId], dx = e.clientX - p[0], dy = e.clientY - p[1], k = FE.cam.hfov / (cv.clientWidth || 600);
    if (FE.cam.follow && Math.abs(dx) + Math.abs(dy) > 0) { FE.cam.follow = null; feFollowUI(); }
    FE.cam.yaw = (FE.cam.yaw - dx * k + 360) % 360; FE.cam.pitch = clamp(FE.cam.pitch + dy * k, -30, 89);
    pts[e.pointerId] = [e.clientX, e.clientY]; kick();
  });
  function up(e) { delete pts[e.pointerId]; lastD = 0; }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('blur', function () { pts = {}; lastD = 0; });
  cv.addEventListener('wheel', function (e) { if (!e.ctrlKey && document.activeElement !== cv) return; e.preventDefault(); feZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  cv.addEventListener('keydown', function (e) {
    var k = FE.cam.hfov / 20;
    if (e.key === 'ArrowLeft') FE.cam.yaw = (FE.cam.yaw - 2 * k + 360) % 360; else if (e.key === 'ArrowRight') FE.cam.yaw = (FE.cam.yaw + 2 * k) % 360;
    else if (e.key === 'ArrowUp') FE.cam.pitch = clamp(FE.cam.pitch + k, -30, 89); else if (e.key === 'ArrowDown') FE.cam.pitch = clamp(FE.cam.pitch - k, -30, 89);
    else if (e.key === '+' || e.key === '=') { feZoom(1 / 1.25); e.preventDefault(); return; } else if (e.key === '-') { feZoom(1.25); e.preventDefault(); return; }
    else return;
    FE.cam.follow = null; feFollowUI(); e.preventDefault(); kick();
  });
  $('feLook').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-fe]'); if (!b) return;
    var k = b.getAttribute('data-fe');
    if (k === 'moonzoom') feLook('moon', 2.2); else if (k === 'wide') feLook('wide', 90); else feLook(k, FE.cam.hfov < 30 ? FE.cam.hfov : 70);
  });
  $('feZoomIn').addEventListener('click', function () { feZoom(1 / 1.6); });
  $('feZoomOut').addEventListener('click', function () { feZoom(1.6); });
})();
/* Plain-language status under the view and in the readout. */
function feText(g) {
  var s = SITES[S.sel], L = LWB.look(s.geo, S.tMs), M = g.M, h = [], name = esc(EOBS.name);
  var lim = /DSS-|DSN/.test(EOBS.name) ? DSN_EL : 0;
  h.push('<span><span class="k">From</span> ' + name + '</span>');
  h.push('<span><span class="k">Moon</span> ' + (M.app > 0 ? deg(M.app) + ' up, toward ' + compass16(M.az) + ' (az ' + M.az.toFixed(0) + '°)' : 'below the horizon (' + deg(M.app) + ')') + ' <span class="k">' + Math.round(g.lit * 100) + '% lit, ' + phaseName(g) + '</span></span>');
  if (M.app > -1) h.push('<span><span class="k">Air lifts it by</span> ' + (Astronomy.Refraction('normal', M.alt) * 60).toFixed(1) + '′ <span class="k">(refraction; geometric ' + deg2(M.alt) + ')</span></span>');
  var nx = M.app > 0 ? g.set : g.rise;
  if (nx) h.push('<span><span class="k">' + (M.app > 0 ? 'Moonset' : 'Moonrise') + '</span> ' + fmtDT(nx) + '</span>');
  h.push('<span><span class="k">Site</span> ' + (g.siteUp > 0 ? 'on the side facing us, ' + Math.abs(g.siteLimb).toFixed(1) + '° in from the edge' : Math.abs(g.siteLimb).toFixed(1) + '° past the edge, out of view') + ' · ' + (L.sunFrac > 0 ? '<span class="s">in sunlight</span>' : 'in darkness') + '</span>');
  var talk = L.earthMargin >= S.linkMin && M.app >= lim;
  h.push('<span><span class="k">Could a lander there talk to this place now?</span> ' + (talk ? '<b class="e">Yes</b>' : '<b>No</b>') + ' <span class="k">(Earth is ' + (L.earthMargin >= 0 ? deg2(L.earthMargin) + ' above' : deg2(-L.earthMargin) + ' below') + ' the site\'s skyline; the Moon is ' + (M.app >= 0 ? deg(M.app) + ' up here' : deg(-M.app) + ' below the horizon here') + (lim ? ', and this antenna needs ' + lim + '°' : '') + ')</span></span>');
  h.push('<span>' + learn('libration', 'Why the edge wobbles: libration') + ' · ' + learn('phases', 'Moon phases') + ' · ' + learn('dsn', 'Deep Space Network') + '</span>');
  $('hud').innerHTML = h.join('');
  $('feRead').textContent = 'The Moon in the sky of ' + EOBS.name + ' at ' + fmtDT(S.tMs) + '. Drag to look around; click, then scroll or pinch to zoom. Level ground all round; air near the horizon dims and reddens the Moon (drawn for appearance only).';
  $('feLoc').textContent = EOBS.name;
}

/* ---------- the observer ---------- */
function eLocText() {
  $('eLoc').innerHTML = '<b>' + esc(EOBS.name) + '</b><br><span class="mu">' + fmtCoord(EOBS.lat, EOBS.lon) + (EOBS.h ? ', ' + Math.round(EOBS.h) + ' m' : '') + (EOBS.tz ? ' · ' + esc(EOBS.tz) : '') + (EOBS.src ? ' · ' + esc(EOBS.src) : '') + '</span>';
  $('eLat').value = (+EOBS.lat).toFixed(4); $('eLon').value = (+EOBS.lon).toFixed(4); $('eTz').value = EOBS.tz || '';
}
function setEobs(o) {
  if (o.tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: o.tz }); } catch (x) { $('eMsg').textContent = 'Unknown time zone "' + o.tz + '"; using UTC for local time.'; o.tz = 'UTC'; } }
  EOBS = o; FE.geo = null; FE.moonKey = ''; TZC = {};
  try { localStorage.setItem('lwb.earthobs.v1', JSON.stringify(o)); } catch (x) {}
  eLocText(); setTz(S.tz);
}
var DSS14 = JSON.parse(JSON.stringify(EOBS.src && /810-005/.test(EOBS.src) ? EOBS : { name: 'Goldstone DSS-14 (DSN)', lat: 35 + 25 / 60 + 33.24312 / 3600, lon: 243 + 6 / 60 + 37.66244 / 3600 - 360, h: 1001.390, tz: 'America/Los_Angeles', src: 'DSN 810-005, Module 301, Rev. N, Table 5' }));
$('eDss').addEventListener('click', function () { setEobs(JSON.parse(JSON.stringify(DSS14))); $('eMsg').textContent = ''; });
$('feLoc').addEventListener('click', function () { $('pEarth').open = true; $('pEarth').scrollIntoView({ block: 'center' }); $('eQuery').focus({ preventScroll: true }); });
$('eSearch').addEventListener('submit', function (e) {
  e.preventDefault();
  var q = $('eQuery').value.trim(); if (q.length < 2) { $('eMsg').textContent = 'Type at least two characters.'; return; }
  $('eMsg').textContent = 'Searching…'; $('eResults').innerHTML = '';
  fetch('https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
    var L = (j && j.results) || [];
    if (!L.length) { $('eMsg').textContent = 'No place found for "' + q + '". Try a city name, or a postal code with the city.'; return; }
    $('eMsg').textContent = 'Pick one:';
    FE.found = L;
    $('eResults').innerHTML = L.map(function (p, k) { return '<button type="button" class="link eres" data-k="' + k + '">' + esc(p.name + (p.admin1 ? ', ' + p.admin1 : '') + (p.country ? ', ' + p.country : '')) + '</button>'; }).join('<br>');
  }, function () { $('eMsg').textContent = 'The place search did not answer (offline?). Enter coordinates instead.'; });
});
$('eResults').addEventListener('click', function (e) {
  var b = e.target.closest('[data-k]'); if (!b || !FE.found) return;
  var p = FE.found[+b.getAttribute('data-k')];
  setEobs({ name: p.name + (p.admin1 ? ', ' + p.admin1 : '') + (p.country_code ? ' (' + p.country_code + ')' : ''), lat: p.latitude, lon: p.longitude, h: isFinite(p.elevation) ? p.elevation : 0, tz: p.timezone || 'UTC', src: 'Open-Meteo geocoding (GeoNames); height above sea level' });
  $('eResults').innerHTML = ''; $('eMsg').textContent = '';
});
$('eMine').addEventListener('click', function () {
  if (!navigator.geolocation) { $('eMsg').textContent = 'This browser cannot give a location.'; return; }
  $('eMsg').textContent = 'Asking the browser for your location…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    var tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (x) {}
    setEobs({ name: 'My location', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4), h: pos.coords.altitude || 0, tz: tz, src: 'browser location (kept in this browser)' });
    $('eMsg').textContent = '';
  }, function () { $('eMsg').textContent = 'Location not available (permission refused or no fix).'; }, { timeout: 10000 });
});
$('eManual').addEventListener('submit', function (e) {
  e.preventDefault();
  var lat = parseFloat($('eLat').value), lon = parseFloat($('eLon').value);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90) { $('eMsg').textContent = 'Latitude −90 to 90, longitude −180 to 360.'; return; }
  setEobs({ name: 'Point ' + fmtCoord(lat, ((lon + 540) % 360) - 180), lat: lat, lon: ((lon + 540) % 360) - 180, h: 0, tz: $('eTz').value.trim() || 'UTC', src: 'entered by hand' });
});
eLocText();
window.LWB_FE = function (ms) { var g = feGeom(ms), o = [-g.f[0], -g.f[1], -g.f[2]], bx = dot(o, g.aX), by = dot(o, g.aY), bz = dot(o, g.aZ); return { az: g.M.az, alt: g.M.alt, app: g.M.app, lit: g.lit, siteLimb: g.siteLimb, subLat: Math.asin(bz) * R2D, subLon: Math.atan2(by, bx) * R2D }; };
