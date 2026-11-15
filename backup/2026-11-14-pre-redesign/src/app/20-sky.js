/* ================= sky data ================= */
var STAR = (function () {
  var a = SKY.stars, n = a.length / 4, X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), M = new Float32Array(n), C = [];
  for (var i = 0; i < n; i++) {
    var ra = a[i*4] / 100 * D2R, dec = a[i*4+1] / 100 * D2R;
    X[i] = Math.cos(dec)*Math.cos(ra); Y[i] = Math.cos(dec)*Math.sin(ra); Z[i] = Math.sin(dec);
    M[i] = a[i*4+2] / 100;
    var bv = a[i*4+3] / 100, t = clamp((bv + 0.2) / 1.9, 0, 1);
    var rC = Math.round(170 + 85 * Math.min(1, t * 1.6)), gC = Math.round(195 + 40 * (1 - Math.abs(t - 0.35) * 1.6)), bC = Math.round(255 - 140 * t);
    C.push('rgb(' + rC + ',' + clamp(gC, 150, 240) + ',' + clamp(bC, 110, 255) + ')');
  }
  return { n: n, X: X, Y: Y, Z: Z, M: M, C: C };
})();
function raDecVec(ra, dec) { ra *= D2R; dec *= D2R; return [Math.cos(dec)*Math.cos(ra), Math.cos(dec)*Math.sin(ra), Math.sin(dec)]; }
var NAMES = SKY.names.map(function (n) { return { name: n[0], v: raDecVec(n[1], n[2]) }; });
var LINES = SKY.lines.map(function (seg) { return seg.map(function (p) { return raDecVec(p[0] / 10, p[1] / 10); }); });
var LAND = (function () { var b = atob(SKY.land.b64), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; })();
var MWAY = (function () {
  var b = atob(SKY.mw.rle), out = new Uint8Array(SKY.mw.w * SKY.mw.h), k = 0;
  for (var i = 0; i < b.length; i += 2) { var v = b.charCodeAt(i), n = b.charCodeAt(i + 1); for (var j = 0; j < n; j++) out[k++] = v; }
  return out;
})();
function isLand(lat, lon) {
  var c = Math.floor((lon + 180) * 2), r = Math.floor((90 - lat) * 2);
  c = ((c % 720) + 720) % 720; r = clamp(r, 0, 359);
  var idx = r * 720 + c;
  return (LAND[idx >> 3] >> (idx & 7)) & 1;
}

/* ================= sky renderer ================= */
var skyCv = $('sky'), skyCtx = skyCv.getContext('2d');
var mwCv = document.createElement('canvas'), earthCv = document.createElement('canvas');
/* The time dial lies over the bottom of the sky, so the view centre sits above the middle of the canvas. */
var DIAL_PAD = 110;
function skySize() { return [skyCv.clientWidth || 600, skyCv.clientHeight || 500]; }
function dirAA(az, alt) { return [Math.sin(az)*Math.cos(alt), Math.cos(az)*Math.cos(alt), Math.sin(alt)]; }
function makeCam(W, H) {
  var yaw = cam.yaw * D2R, pit = cam.pitch * D2R;
  var f = [Math.sin(yaw)*Math.cos(pit), Math.cos(yaw)*Math.cos(pit), Math.sin(pit)];
  var r = [Math.cos(yaw), -Math.sin(yaw), 0];
  return { f: f, r: r, u: cross(r, f), F: (W / 2) / Math.tan(cam.hfov * D2R / 2), cx: W / 2, cy: (H - DIAL_PAD) / 2, W: W, H: H };
}
function proj(C, v) {
  var z = v[0]*C.f[0] + v[1]*C.f[1] + v[2]*C.f[2];
  if (z <= 1e-4) return null;
  return [C.cx + (v[0]*C.r[0] + v[1]*C.r[1] + v[2]*C.r[2]) / z * C.F, C.cy - (v[0]*C.u[0] + v[1]*C.u[1] + v[2]*C.u[2]) / z * C.F, z];
}
function enuBasis(f, s) { return { E: fromBF(f, s.e), N: fromBF(f, s.n), U: fromBF(f, s.u) }; }
function toENU(B, v) { return [dot(v, B.E), dot(v, B.N), dot(v, B.U)]; }
function fromENU(B, v) { return [v[0]*B.E[0]+v[1]*B.N[0]+v[2]*B.U[0], v[0]*B.E[1]+v[1]*B.N[1]+v[2]*B.U[1], v[0]*B.E[2]+v[1]*B.N[2]+v[2]*B.U[2]]; }
function azAlt(v) { var l = Math.hypot(v[0], v[1], v[2]); return { az: (Math.atan2(v[0], v[1]) * R2D + 360) % 360, alt: Math.asin(clamp(v[2] / l, -1, 1)) * R2D }; }
function onScreen(p, C, m) { return p && p[0] > -m && p[0] < C.W + m && p[1] > -m && p[1] < C.H + m; }
var lastSky = null;

function renderSky() {
  if (S.view !== 'site') return;
  if (S.skyMode === 'polar') { renderPolarSky(); return; }
  if (S.skyMode === '3d') { render3D(); return; }
  var sz = skySize(), W = sz[0], Hh = sz[1];
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (skyCv.width !== Math.round(W * dpr) || skyCv.height !== Math.round(Hh * dpr)) { skyCv.width = Math.round(W * dpr); skyCv.height = Math.round(Hh * dpr); }
  var c = skyCtx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  var site = SITES[S.sel], f = frame(S.tMs), B = enuBasis(f, site), C = makeCam(W, Hh);
  // Sun and Earth come from the core (SPICE, MOON_ME); the star field and Earth texture use the
  // astronomy-engine frame, which differs by far less than a pixel.
  var L0 = LWB.look(site.geo, S.tMs), G = site.geo;
  var sunE = dirAA(L0.sunAz * D2R, L0.sunEl * D2R), sunAA = { az: L0.sunAz, alt: L0.sunEl }, sunAlt = sunAA.alt;
  var earthE = dirAA(L0.earthAz * D2R, L0.earthEl * D2R), earthAA = { az: L0.earthAz, alt: L0.earthEl }, earthDist = L0.earthRange, earthDir = fromENU(B, earthE);
  var earthFrac = (1 + dot(f.sunGeoU, f.xr)) / 2;
  var sunUp = L0.sunFrac > 0, earthUp = L0.earthFrac > 0, lowCut = Math.min(G.hMin, 0) - 1.5, loSin = Math.sin(lowCut * D2R);
  var dim = sunUp ? 1 - 0.58 * Math.min(1, L0.sunFrac * 2) : (earthUp ? 0.8 : 1);

  // 1. space
  c.fillStyle = '#020306'; c.fillRect(0, 0, W, Hh);
  // 2. Milky Way, low-res pass
  var mw = 6, mwW = Math.ceil(W / mw), mwH = Math.ceil(Hh / mw);
  mwCv.width = mwW; mwCv.height = mwH;
  var mctx = mwCv.getContext('2d'), mimg = mctx.createImageData(mwW, mwH), md = mimg.data;
  for (var py = 0; py < mwH; py++) for (var px = 0; px < mwW; px++) {
    var sx = ((px + 0.5) * mw - C.cx) / C.F, sy = -((py + 0.5) * mw - C.cy) / C.F;
    var ve = sx*C.r[0] + sy*C.u[0] + C.f[0], vn = sx*C.r[1] + sy*C.u[1] + C.f[1], vu = sx*C.r[2] + sy*C.u[2] + C.f[2];
    if (vu < Math.min(loSin, -0.05)) continue;
    var qx = ve*B.E[0] + vn*B.N[0] + vu*B.U[0], qy = ve*B.E[1] + vn*B.N[1] + vu*B.U[1], qz = ve*B.E[2] + vn*B.N[2] + vu*B.U[2];
    var ra = Math.atan2(qy, qx) * R2D; if (ra < 0) ra += 360;
    var dec = Math.atan2(qz, Math.hypot(qx, qy)) * R2D;
    var lv = MWAY[clamp(Math.floor(90 - dec), 0, 179) * 360 + (Math.floor(ra) % 360)];
    if (!lv) continue;
    var o = (py * mwW + px) * 4, a = lv / 5;
    md[o] = 150; md[o+1] = 165; md[o+2] = 205; md[o+3] = Math.round(255 * (0.05 + 0.21 * a) * dim);
  }
  mctx.putImageData(mimg, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(mwCv, 0, 0, mwW * mw, mwH * mw);

  // 3. constellation lines
  var i, p, q;
  if (S.opt.lines) {
    c.strokeStyle = 'rgba(120,150,205,' + (0.28 * dim).toFixed(3) + ')'; c.lineWidth = 1; c.beginPath();
    for (i = 0; i < LINES.length; i++) {
      var seg = LINES[i], prev = null;
      for (var k = 0; k < seg.length; k++) {
        p = proj(C, toENU(B, seg[k]));
        if (p && prev) { c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); }
        prev = p;
      }
    }
    c.stroke();
  }
  // 4. stars
  var zf = Math.pow(clamp(70 / cam.hfov, 0.6, 12), 0.35);
  for (i = 0; i < STAR.n; i++) {
    var x = STAR.X[i], y = STAR.Y[i], z = STAR.Z[i];
    var eu = x*B.U[0] + y*B.U[1] + z*B.U[2];
    if (eu < loSin) continue;
    var ee = x*B.E[0] + y*B.E[1] + z*B.E[2], en = x*B.N[0] + y*B.N[1] + z*B.N[2];
    var zc = ee*C.f[0] + en*C.f[1] + eu*C.f[2];
    if (zc <= 0.01) continue;
    var spx = C.cx + (ee*C.r[0] + en*C.r[1] + eu*C.r[2]) / zc * C.F, spy = C.cy - (ee*C.u[0] + en*C.u[1] + eu*C.u[2]) / zc * C.F;
    if (spx < -4 || spx > W + 4 || spy < -4 || spy > Hh + 4) continue;
    var m = STAR.M[i], rad = Math.max(0.45, (2.7 - 0.42 * m)) * zf * 0.62, al = clamp(1.3 - m * 0.19, 0.12, 1) * dim;
    c.globalAlpha = al; c.fillStyle = STAR.C[i];
    if (rad < 0.95) c.fillRect(spx - rad, spy - rad, rad * 2, rad * 2);
    else { c.beginPath(); c.arc(spx, spy, rad, 0, 6.2832); c.fill(); }
  }
  c.globalAlpha = 1;
  if (S.opt.names && cam.hfov < 110) {
    c.font = '10.5px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(200,212,230,' + (0.55 * dim).toFixed(2) + ')'; c.textBaseline = 'middle'; c.textAlign = 'left';
    NAMES.forEach(function (nm) { var e = toENU(B, nm.v); if (e[2] < 0.02) return; var pp = proj(C, e); if (onScreen(pp, C, 0)) c.fillText(nm.name, pp[0] + 6, pp[1] - 6); });
  }
  // 6. sun
  var sunP = sunAlt > lowCut - 1 ? proj(C, sunE) : null, sunR = C.F * Math.tan(L0.sunRad * D2R);
  if (sunP && onScreen(sunP, C, 400)) {
    var gr = Math.max(26, sunR * 9), g = c.createRadialGradient(sunP[0], sunP[1], 0, sunP[0], sunP[1], gr);
    g.addColorStop(0, 'rgba(255,250,235,0.95)'); g.addColorStop(0.12, 'rgba(255,236,190,0.55)'); g.addColorStop(0.4, 'rgba(255,214,150,0.12)'); g.addColorStop(1, 'rgba(255,200,130,0)');
    c.fillStyle = g; c.beginPath(); c.arc(sunP[0], sunP[1], gr, 0, 6.2832); c.fill();
    c.fillStyle = '#FFFDF6'; c.beginPath(); c.arc(sunP[0], sunP[1], Math.max(2.5, sunR), 0, 6.2832); c.fill();
  }
  // 7. earth
  var earthP = earthAA.alt > lowCut - 1.5 ? proj(C, earthE) : null;
  var earthRpx = C.F * Math.tan(Math.asin(RE / earthDist));
  if (earthP && onScreen(earthP, C, earthRpx + 10)) drawEarth(c, C, B, f, earthDir, earthRpx, earthP);
  // 7b. relay satellites (before the ground, so the skyline hides them)
  var tt = {};
  c.font = '10.5px "IBM Plex Mono", monospace'; c.textBaseline = 'middle'; c.textAlign = 'left';
  satsOn().forEach(function (q) {
    var pm = satME(q, S.tMs); if (!pm) return;
    LWB.topo(G, pm, tt); if (tt.el < lowCut - 1) return;
    var sp = proj(C, dirAA(tt.az * D2R, tt.el * D2R)); if (!onScreen(sp, C, 20)) return;
    c.fillStyle = HERO.relay; c.beginPath(); c.moveTo(sp[0], sp[1] - 5); c.lineTo(sp[0] + 5, sp[1]); c.lineTo(sp[0], sp[1] + 5); c.lineTo(sp[0] - 5, sp[1]); c.closePath(); c.fill();
    c.fillStyle = 'rgba(230,234,240,.85)'; c.fillText(q.name, sp[0] + 8, sp[1]);
  });
  // 8. ground
  drawGround(c, C, B, site, sunE, sunUp ? Math.max(sunAlt, 0.3) : -1, earthUp, earthFrac, L0.sunFrac);
  // 9. compass + grid
  drawCompass(c, C);
  // 10. glare
  if (sunP && sunUp && onScreen(sunP, C, W)) {
    c.globalCompositeOperation = 'lighter';
    var gl = c.createRadialGradient(sunP[0], sunP[1], 0, sunP[0], sunP[1], W * 0.45);
    gl.addColorStop(0, 'rgba(255,230,190,' + (0.16 * L0.sunFrac).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(255,230,190,0)');
    c.fillStyle = gl; c.fillRect(0, 0, W, Hh);
    c.globalCompositeOperation = 'source-over';
  }
  lastSky = { sun: sunAA, earth: earthAA, earthFrac: earthFrac, L: L0 };
  updateHud();
}

function drawEarth(c, C, B, f, earthDir, Rpx, P) {
  if (Rpx < 2.2) {
    var fr = (1 + dot(f.sunGeoU, f.xr)) / 2;
    c.fillStyle = 'rgba(160,200,255,' + (0.35 + 0.65 * fr).toFixed(2) + ')';
    c.beginPath(); c.arc(P[0], P[1], Math.max(1.6, Rpx), 0, 6.2832); c.fill();
    return;
  }
  var res = Math.min(Math.ceil(Rpx), 170), size = res * 2 + 2;
  earthCv.width = size; earthCv.height = size;
  var ec = earthCv.getContext('2d'), img = ec.createImageData(size, size), d = img.data;
  var rE = fromENU(B, C.r), uE = fromENU(B, C.u), Cd = earthDir;
  var R1 = unit(sub(rE, scl(Cd, dot(rE, Cd)))), U1 = sub(uE, scl(Cd, dot(uE, Cd))); U1 = unit(sub(U1, scl(R1, dot(U1, R1))));
  var rot = earthRot(f.time), Sg = f.sunGeoU, half = size / 2;
  for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
    var nx = (i + 0.5 - half) / res, ny = -(j + 0.5 - half) / res, rr = nx*nx + ny*ny;
    if (rr > 1 + 2.5 / res) continue;
    var rad = Math.sqrt(rr), mu = Math.sqrt(Math.max(0, 1 - rr));
    var Nx = nx*R1[0] + ny*U1[0] - mu*Cd[0], Ny = nx*R1[1] + ny*U1[1] - mu*Cd[1], Nz = nx*R1[2] + ny*U1[2] - mu*Cd[2];
    var lam = Nx*Sg[0] + Ny*Sg[1] + Nz*Sg[2];
    var qx = Nx*rot.ex[0] + Ny*rot.ey[0] + Nz*rot.ez[0], qy = Nx*rot.ex[1] + Ny*rot.ey[1] + Nz*rot.ez[1], qz = Nx*rot.ex[2] + Ny*rot.ey[2] + Nz*rot.ez[2];
    var lat = Math.asin(clamp(qz, -1, 1)) * R2D, lon = Math.atan2(qy, qx) * R2D - rot.gast;
    lon = ((lon + 540) % 360) - 180;
    var land = isLand(lat, lon), ice = Math.abs(lat) > 72 || (land && Math.abs(lat) > 62);
    var cr, cg, cb;
    if (ice) { cr = 222; cg = 230; cb = 238; } else if (land) { var dry = Math.abs(lat) > 12 && Math.abs(lat) < 35 ? 1 : 0; cr = dry ? 168 : 92; cg = dry ? 146 : 116; cb = dry ? 98 : 70; } else { cr = 22; cg = 58; cb = 118; }
    var lit = clamp(lam * 1.25 + 0.04, 0, 1); lit = Math.pow(lit, 0.75);
    var k = 0.035 + 0.965 * lit;
    var atm = Math.pow(1 - mu, 3.2) * clamp(lam + 0.2, 0, 1) * 0.6;
    var o = (j * size + i) * 4;
    d[o] = clamp(cr * k + 80 * atm, 0, 255); d[o+1] = clamp(cg * k + 140 * atm, 0, 255); d[o+2] = clamp(cb * k + 240 * atm, 0, 255);
    d[o+3] = Math.round(255 * clamp((1 - rad) * res + 0.5, 0, 1));
  }
  ec.putImageData(img, 0, 0);
  var sc = Rpx / res;
  c.drawImage(earthCv, P[0] - half * sc, P[1] - half * sc, size * sc, size * sc);
}

function drawGround(c, C, B, site, sunE, sunAlt, earthUp, earthFrac, sunFrac) {
  var yaw = cam.yaw * D2R;
  var pA = proj(C, dirAA(yaw - 1.2, 0)), pB = proj(C, dirAA(yaw + 1.2, 0));
  if (!pA || !pB) return;
  var dx = pB[0] - pA[0], dy = pB[1] - pA[1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, L = 1e5;
  var nx = -uy, ny = ux, g = proj(C, dirAA(yaw, -0.4));
  if (g) { if ((g[0] - pA[0]) * nx + (g[1] - pA[1]) * ny < 0) { nx = -nx; ny = -ny; } } else if (ny < 0) { nx = -nx; ny = -ny; }
  var a = [pA[0] - ux * L, pA[1] - uy * L], b = [pB[0] + ux * L, pB[1] + uy * L];
  // light level
  var Lg;
  if (sunAlt > 0) Lg = (0.36 + 0.56 * Math.min(1, Math.sin(sunAlt * D2R) / Math.sin(30 * D2R))) * (0.3 + 0.7 * sunFrac);
  else Lg = 0.014 + (earthUp ? 0.07 * earthFrac : 0);
  var base = [184 * Lg, 178 * Lg, 168 * Lg];
  if (sunAlt <= 0 && earthUp) base = [base[0] * 0.85, base[1] * 0.93, base[2] * 1.12];
  // opposition brightening across the screen
  var sunAz = Math.atan2(sunE[0], sunE[1]);
  var xg = c.createLinearGradient(0, 0, C.W, 0);
  for (var k = 0; k <= 8; k++) {
    var sxp = k / 8 * C.W, t = ((sxp - pA[0]) * ux + 0), hy = pA[1] + (ux !== 0 ? (sxp - pA[0]) / ux * uy : 0);
    var rx = (sxp - C.cx) / C.F, ry = -(hy - C.cy) / C.F;
    var v = [rx*C.r[0] + ry*C.u[0] + C.f[0], rx*C.r[1] + ry*C.u[1] + C.f[1]];
    var daz = Math.atan2(v[0], v[1]) - sunAz;
    var fac = sunAlt > 0 ? 0.72 + 0.5 * (1 - Math.cos(daz)) / 2 : 1;
    xg.addColorStop(k / 8, 'rgb(' + Math.round(base[0] * fac) + ',' + Math.round(base[1] * fac) + ',' + Math.round(base[2] * fac) + ')');
  }
  // The ground is everything below the horizon profile: the LOLA mask where the site has one, else the smooth sphere.
  var G = site.geo, half = Math.min(88, cam.hfov / 2 + 14), nseg = G.mask ? 220 : 24, hp = [], k2;
  for (k2 = 0; k2 <= nseg; k2++) {
    var azd = cam.yaw - half + 2 * half * k2 / nseg, pp0 = proj(C, dirAA(azd * D2R, LWB.horizonAt(G, ((azd % 360) + 360) % 360) * D2R));
    if (pp0) hp.push(pp0);
  }
  if (hp.length < 2) return;
  c.save();
  c.beginPath(); c.moveTo(Math.min(-20, hp[0][0]), hp[0][1]);
  for (k2 = 0; k2 < hp.length; k2++) c.lineTo(hp[k2][0], hp[k2][1]);
  c.lineTo(Math.max(C.W + 20, hp[hp.length - 1][0]), hp[hp.length - 1][1]);
  c.lineTo(Math.max(C.W + 20, hp[hp.length - 1][0]), C.H + L); c.lineTo(Math.min(-20, hp[0][0]), C.H + L); c.closePath();
  c.fillStyle = xg; c.fill();
  c.clip();
  var vg = c.createLinearGradient(pA[0], pA[1], pA[0] + nx * C.H, pA[1] + ny * C.H);
  vg.addColorStop(0, 'rgba(255,255,255,0.05)'); vg.addColorStop(0.08, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = vg; c.fillRect(-10, -10, C.W + 20, C.H + 20);
  if (G.mask) { // far terrain: a slightly darker band between the skyline and the local foreground
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1; c.beginPath();
    for (k2 = 0; k2 < hp.length; k2++) { if (k2) c.lineTo(hp[k2][0], hp[k2][1]); else c.moveTo(hp[k2][0], hp[k2][1]); }
    c.stroke();
  }

  c.restore();
}

function drawCompass(c, C) {
  c.font = '500 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom';
  for (var az = 0; az < 360; az += 15) {
    var p = proj(C, dirAA(az * D2R, 0)); if (!onScreen(p, C, 30)) continue;
    var major = az % 45 === 0;
    c.strokeStyle = 'rgba(230,235,240,' + (major ? 0.7 : 0.35) + ')'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], p[1] - (major ? 9 : 5)); c.stroke();
    if (major) { c.fillStyle = az === 0 ? '#F2B24B' : 'rgba(230,235,240,0.85)'; c.fillText(COMPASS[az / 45], p[0], p[1] - 11); }
    else if (cam.hfov < 70) { c.fillStyle = 'rgba(230,235,240,0.45)'; c.fillText(az + '°', p[0], p[1] - 7); }
  }
  if (!S.opt.grid) return;
  c.strokeStyle = 'rgba(111,179,242,0.22)'; c.lineWidth = 1; c.fillStyle = 'rgba(111,179,242,0.6)'; c.textAlign = 'left'; c.textBaseline = 'bottom';
  [15, 30, 45, 60, 75].forEach(function (alt) {
    c.beginPath(); var prev = null;
    for (var az2 = 0; az2 <= 360; az2 += 3) { var pp = proj(C, dirAA(az2 * D2R, alt * D2R)); if (pp && prev && Math.abs(pp[0] - prev[0]) < C.W) { c.moveTo(prev[0], prev[1]); c.lineTo(pp[0], pp[1]); } prev = pp; }
    c.stroke();
    var lp = proj(C, dirAA(cam.yaw * D2R, alt * D2R)); if (onScreen(lp, C, 0)) c.fillText(alt + '°', lp[0] + 4, lp[1] - 2);
  });
  for (var a2 = 0; a2 < 360; a2 += 30) { c.beginPath(); var pv = null; for (var al = 0; al <= 88; al += 4) { var p2 = proj(C, dirAA(a2 * D2R, al * D2R)); if (p2 && pv) { c.moveTo(pv[0], pv[1]); c.lineTo(p2[0], p2[1]); } pv = p2; } c.stroke(); }
}

function updateHud() {
  if (!lastSky) return;
  var L = lastSky, h = [];
  h.push('<span><span class="k">Sun </span>' + deg2(L.sun.alt) + ' <span class="k">az</span> ' + L.sun.az.toFixed(1) + '° <span class="k">· ' + pct(L.L.sunFrac) + ' of disk visible</span></span>');
  h.push('<span><span class="k">Earth </span>' + deg2(L.earth.alt) + ' <span class="k">az</span> ' + L.earth.az.toFixed(1) + '° <span class="k">· ' + (L.L.earthFrac >= 1 ? 'in view' : L.L.earthFrac <= 0 ? 'hidden' : pct(L.L.earthFrac) + ' of disk visible') + ' · phase ' + Math.round(L.earthFrac * 100) + '%</span></span>');
  $('hud').innerHTML = h.join('');
}

/* camera controls */
var anim = null;
function lookAt(az, alt, hfov) {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var target = { yaw: az, pitch: clamp(alt, -20, 80), hfov: clamp(hfov, 1.5, 120) };
  var dyaw = ((target.yaw - cam.yaw + 540) % 360) - 180;
  if (reduce) { cam.yaw = (cam.yaw + dyaw + 360) % 360; cam.pitch = target.pitch; cam.hfov = target.hfov; renderSky(); return; }
  var from = { yaw: cam.yaw, pitch: cam.pitch, hfov: cam.hfov }, t0 = performance.now();
  anim = function (now) {
    var k = clamp((now - t0) / 550, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    cam.yaw = (from.yaw + dyaw * e + 360) % 360; cam.pitch = from.pitch + (target.pitch - from.pitch) * e;
    cam.hfov = Math.exp(Math.log(from.hfov) + (Math.log(target.hfov) - Math.log(from.hfov)) * e);
    if (k >= 1) anim = null;
  };
  kick();
}
function defaultView() {
  var L0 = LWB.look(SITES[S.sel].geo, S.tMs);
  var e = { az: L0.earthAz, alt: L0.earthEl }, s = { az: L0.sunAz, alt: L0.sunEl };
  // Prefer the Sun when it is up (landing light and shadows), else Earth. Keep the horizon in the lower third.
  var t = L0.sunFrac > 0 || L0.earthFrac <= 0 ? s : e;
  var sz = skySize(), aspect = sz[0] / Math.max(200, sz[1] - DIAL_PAD);
  var pitch = clamp(t.alt * 0.5, 8, 24);
  var need = Math.max(36, (t.alt - pitch + 10) * 2);
  var hf = clamp(2 * Math.atan(Math.tan(Math.min(need, 80) * D2R / 2) * aspect) * R2D, 70, 105);
  cam.yaw = (t.az - (t === s ? hf * 0.18 : 0) + 360) % 360; cam.pitch = pitch; cam.hfov = hf;
}
function renderLook() {
  var b = '<button type="button" data-look="earth">Earth</button><button type="button" data-look="sun">Sun</button>' + (SITES[S.sel].geo.mask ? '<button type="button" data-look="horizon">Skyline</button>' : '');
  b += '<button type="button" data-look="wide">Wide</button>';
  $('look').innerHTML = b;
}
$('look').addEventListener('click', function (e) {
  var t = e.target.closest('button'); if (!t) return;
  var k = t.getAttribute('data-look'), site = SITES[S.sel];
  var L0 = LWB.look(site.geo, S.tMs);
  if (k === 'earth') lookAt(L0.earthAz, L0.earthEl, 6);
  else if (k === 'sun') lookAt(L0.sunAz, L0.sunEl, site.geo.mask ? 5 : 40);
  else if (k === 'horizon') lookAt(L0.sunAz, 2, 28);
  else if (k === 'wide') { lookAt(cam.yaw, 14, 100); }
});
(function () {
  var pts = {}, lastD = 0;
  skyCv.addEventListener('pointerdown', function (e) { pts[e.pointerId] = [e.clientX, e.clientY]; try { skyCv.setPointerCapture(e.pointerId); } catch (x) {} anim = null; if (e.pointerType === 'mouse') skyCv.focus({ preventScroll: true }); });
  skyCv.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    var ids = Object.keys(pts);
    if (ids.length === 2) {
      pts[e.pointerId] = [e.clientX, e.clientY];
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastD) cam.hfov = clamp(cam.hfov * lastD / d, 1.5, 120);
      lastD = d; kick(); return;
    }
    var p = pts[e.pointerId], dx = e.clientX - p[0], dy = e.clientY - p[1], k = cam.hfov / (skyCv.clientWidth || 600);
    cam.yaw = (cam.yaw - dx * k + 360) % 360; cam.pitch = clamp(cam.pitch + dy * k, -45, 85);
    pts[e.pointerId] = [e.clientX, e.clientY]; kick();
  });
  function up(e) { delete pts[e.pointerId]; lastD = 0; }
  skyCv.addEventListener('pointerup', up); skyCv.addEventListener('pointercancel', up);
  /* The sky is not the whole page, so the wheel scrolls the page unless the sky has been clicked (it then has
     focus) or the gesture is a trackpad pinch (ctrlKey). Touch: vertical swipes scroll (touch-action: pan-y),
     horizontal drags turn the view, two fingers zoom. */
  var wheelHint = 0;
  skyCv.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && document.activeElement !== skyCv) {
      var n = $('skyNote'), was = n.textContent;
      if (!wheelHint) { wheelHint = setTimeout(function () { n.textContent = was; wheelHint = 0; }, 1800); n.textContent = 'Click the sky, then scroll to zoom, or use − / +'; }
      return;
    }
    e.preventDefault(); cam.hfov = clamp(cam.hfov * Math.exp(e.deltaY * 0.0012), 1.5, 120); kick();
  }, { passive: false });
  skyCv.addEventListener('blur', function () { pts = {}; lastD = 0; });
  skyCv.addEventListener('keydown', function (e) {
    var k = cam.hfov / 20;
    if (e.key === 'ArrowLeft') cam.yaw = (cam.yaw - k * 2 + 360) % 360; else if (e.key === 'ArrowRight') cam.yaw = (cam.yaw + k * 2) % 360;
    else if (e.key === 'ArrowUp') cam.pitch = clamp(cam.pitch + k, -45, 85); else if (e.key === 'ArrowDown') cam.pitch = clamp(cam.pitch - k, -45, 85);
    else if (e.key === '+' || e.key === '=') cam.hfov = clamp(cam.hfov / 1.25, 1.5, 120); else if (e.key === '-') cam.hfov = clamp(cam.hfov * 1.25, 1.5, 120);
    else return;
    e.preventDefault(); kick();
  });
})();
$('zoomIn').addEventListener('click', function () { lookAt(cam.yaw, cam.pitch, cam.hfov / 1.6); });
$('zoomOut').addEventListener('click', function () { lookAt(cam.yaw, cam.pitch, cam.hfov * 1.6); });
