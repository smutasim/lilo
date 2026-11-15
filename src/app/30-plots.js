/* ================= timeline, maps, skyline ================= */
var C2 = {};
function hexRGB(h) { h = h.replace('#', ''); return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
/* Canvas colours follow the theme: read from the CSS tokens at boot and whenever the theme changes. */
function readColors() {
  var cs = getComputedStyle(document.documentElement);
  ['--ink','--mute','--faint','--line','--line-2','--sun','--earth','--relay','--go','--warn','--stop','--panel','--panel-2','--track','--track2','--terrain','--gridline','--zero','--near','--far','--sel','--disk'].forEach(function (k) { C2[k] = cs.getPropertyValue(k).trim(); });
  C2.sunRGB = hexRGB(C2['--disk']); C2.earthRGB = hexRGB(C2['--earth']);
  // the time strip lies over the sky, which is dark in both themes: it uses the hero's own tokens
  var hs = getComputedStyle(document.querySelector('.hero'));
  [['go', '--go'], ['earth', '--earth'], ['ink', '--ink'], ['line', '--tick'], ['mute', '--mute'], ['sun', '--sun']].forEach(function (p) { var v = hs.getPropertyValue(p[1]).trim(); if (v) HERO[p[0]] = v; });
  HERO.sunRGB = hexRGB(HERO.sun);
}
var HERO = { go: '#47C98D', earth: '#6FB3F2', relay: '#B9A0F5', ink: '#E6EAF0', line: '#3A4350', mute: '#9AA4B2', sun: '#F2B24B', sunRGB: '242,178,75' };
function fit(cv, h) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth || 300;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c: c, w: w, h: h };
}
function spanSteps() { return S.spanD * PER_DAY; }
/* The timeline: one row per thing that can be in view, on the same time axis.
   Sun (brighter = more of the disk), Earth (clear of the skyline by the margin), one row per shown satellite
   (every pass, from satPasses), and the times all constraints are met. The bracket is the statistics period. */
var TL = { L: 96, R: 10, rows: [], pw: 0 };
function tlRows() {
  var rows = [{ k: 'sun', name: 'Sun' }, { k: 'earth', name: 'Earth' }];
  satsShown().forEach(function (q) { rows.push({ k: 'sat', name: q.name, q: q }); });
  COMMS.sats.forEach(function (q) { if (q.on && q.job) rows.push({ k: 'wait', name: q.name }); });
  rows.push({ k: 'open', name: 'Constraints met' });
  return rows;
}
function drawStrip() {
  var rows = tlRows(), rh = 17, top = 6, axisH = 20, h = top + rows.length * rh + axisH;
  var cv = $('strip'); cv.style.height = h + 'px';
  var f = fit(cv, h), c = f.c, w = f.w, site = SITES[S.sel], n = spanSteps();
  var L = w < 520 ? 70 : TL.L, pw = Math.max(50, w - L - TL.R), bh = rh - 5;
  TL.pw = pw; TL.left = L; TL.rows = rows;
  var t0 = S.startMs, tspan = n * STEP_MS;
  function X(ms) { return L + (ms - t0) / tspan * pw; }
  c.font = '11.5px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle';
  // day grid behind the rows
  var stepD = [1, 2, 5, 7, 10, 15, 30].filter(function (d) { return S.spanD / d <= Math.max(3, Math.floor(pw / 78)); })[0] || 30, d;
  c.fillStyle = C2['--line']; for (d = 0; d <= S.spanD; d += stepD) c.fillRect(Math.round(L + d / S.spanD * pw), top - 2, 1, rows.length * rh + 4);
  rows.forEach(function (r, k) {
    var y = top + k * rh + 2, x, a, b, i;
    c.fillStyle = C2['--ink']; c.textAlign = 'right';
    var nm = r.name; while (nm.length > 3 && c.measureText(nm).width > L - 12) nm = nm.slice(0, -2) + '…';
    c.fillText(nm, L - 8, y + bh / 2);
    c.fillStyle = C2['--track']; c.fillRect(L, y, pw, bh);
    if (r.k === 'sat') {
      c.fillStyle = C2['--relay'];
      satPasses(site, r.q).forEach(function (p) { var xa = X(p.t0), xb = X(p.t1); c.fillRect(xa, y, Math.max(1, xb - xa), bh); });
      return;
    }
    if (r.k === 'wait') { c.fillStyle = C2['--mute']; c.textAlign = 'left'; c.fillText('propagating…', L + 6, y + bh / 2); return; }
    for (x = 0; x < pw; x++) {
      a = Math.floor(x / pw * n); b = Math.max(a + 1, Math.floor((x + 1) / pw * n));
      var mf = 0, on = 0;
      if (r.k === 'sun') { for (i = a; i < b && i < n; i++) if (site.sunFrac[i] > mf) mf = site.sunFrac[i]; if (mf > 0) { c.fillStyle = 'rgba(' + C2.sunRGB + ',' + (0.3 + 0.7 * mf).toFixed(2) + ')'; c.fillRect(L + x, y, 1, bh); } }
      else if (r.k === 'earth') { for (i = a; i < b && i < n; i++) if (site.earthMar[i] >= S.linkMin) { on = 1; break; } if (on) { c.fillStyle = C2['--earth']; c.fillRect(L + x, y, 1, bh); } }
      else { for (i = a; i < b && i < n; i++) if (site.open[i]) { on = 1; break; } if (on) { c.fillStyle = C2['--go']; c.fillRect(L + x, y, 1, bh); } }
    }
  });
  // axis
  var ay = top + rows.length * rh + 2;
  c.textAlign = 'left'; c.textBaseline = 'top'; c.font = '11px "Segoe UI", Arial, sans-serif';
  for (d = 0; d < S.spanD; d += stepD) { var tx = L + d / S.spanD * pw; c.fillStyle = C2['--line-2'] || C2['--mute']; c.fillRect(Math.round(tx), ay - 2, 1, 5); c.fillStyle = C2['--mute']; c.fillText(fmtDay(S.startMs + d * DAY), tx + 3, ay + 3); }
  // statistics period and the current time
  var i0 = stepOf(S.tMs), hx0 = L + i0 / n * pw, hx1 = Math.min(L + pw, L + (i0 + S.horizonD * PER_DAY) / n * pw);
  c.fillStyle = 'rgba(31,95,168,0.07)'; c.fillRect(hx0, top - 2, hx1 - hx0, rows.length * rh + 4);
  c.strokeStyle = C2['--ink']; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(Math.round(hx1) + 0.5, top - 2); c.lineTo(Math.round(hx1) + 0.5, ay + 2); c.stroke(); c.setLineDash([]);
  var cx = X(S.tMs);
  c.fillStyle = C2['--stop']; c.fillRect(cx - 1, top - 4, 2, rows.length * rh + 8);
  c.beginPath(); c.moveTo(cx - 5, top - 6); c.lineTo(cx + 5, top - 6); c.lineTo(cx, top + 1); c.closePath(); c.fill();
}

/* ---------- whole-Moon map ---------- */
function mapsShowing() { return S.view === 'site' && S.atab === 'maps'; }
var GRID = null, mapOff = document.createElement('canvas'); mapOff.width = 360; mapOff.height = 180;
function buildGrid() {
  GRID = new Float32Array(360 * 180 * 3);
  for (var j = 0; j < 180; j++) { var lat = (89.5 - j) * D2R, cl = Math.cos(lat), sl = Math.sin(lat);
    for (var i = 0; i < 360; i++) { var lon = (-179.5 + i) * D2R, k = (j * 360 + i) * 3; GRID[k] = cl * Math.cos(lon); GRID[k+1] = cl * Math.sin(lon); GRID[k+2] = sl; } }
}
var _dm = LWB.newDirs();
/* LROC WAC global morphologic mosaic (data/imagery_global.json, tools/imagery/make_global.py): same simple
   cylindrical grid as this map, 180W to 180E, 90N to 90S. Display only; the night side is shaded over it. */
var globImg = null, globReady = false;
if (GLOBALIMG) { globImg = new Image(); globImg.onload = function () { globReady = true; if (mapsShowing()) drawMap(); }; globImg.src = 'data:image/jpeg;base64,' + GLOBALIMG.jpeg; }
function siteState(s) { var i = stepOf(S.tMs); return s.open && s.open[i] ? 2 : (s.sunFrac && s.sunFrac[i] > 0 ? 1 : 0); }
function drawMap() {
  var cv = $('map'), w0 = cv.clientWidth || 500, h0 = Math.round(w0 / 2);
  cv.style.height = h0 + 'px';
  var F = fit(cv, h0), c = F.c, w = F.w, h = F.h;
  var D = LWB.dirs(S.tMs, _dm), d = Math.hypot(D.earth[0], D.earth[1], D.earth[2]), sun = unit(D.sun), earth = unit(D.earth);
  var o = mapOff.getContext('2d'), img = o.createImageData(360, 180), px = img.data, ev = new Uint8Array(360 * 180), lm = Math.sin(S.linkMin * D2R);
  for (var q = 0, p = 0; q < 64800; q++, p += 4) {
    var k = q * 3, gx = GRID[k], gy = GRID[k+1], gz = GRID[k+2];
    var ss = sun[0]*gx + sun[1]*gy + sun[2]*gz, ce = earth[0]*gx + earth[1]*gy + earth[2]*gz;
    ev[q] = ((d*ce - RM) / Math.sqrt(d*d - 2*d*RM*ce + RM*RM)) >= lm ? 1 : 0;
    if (globReady) {
      // night side: a dark veil over the image; a 2-degree soft edge at the terminator
      var a = clamp((0.035 - ss) / 0.07, 0, 1);
      px[p] = 5; px[p+1] = 8; px[p+2] = 16; px[p+3] = Math.round(180 * a * a * (3 - 2 * a));
    } else {
      var kk = ss > 0 ? 0.16 + 0.84 * Math.pow(Math.min(1, ss * 1.6), 0.55) : 0;
      px[p] = 22 + 214 * kk; px[p+1] = 28 + 160 * kk; px[p+2] = 40 + 54 * kk; px[p+3] = 255;
    }
  }
  o.putImageData(img, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  if (globReady) { c.drawImage(globImg, 0, 0, w, h); }
  c.drawImage(mapOff, 0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 1; c.beginPath();
  for (var lo = -150; lo <= 150; lo += 30) { var gx2 = Math.round((lo + 180) / 360 * w) + 0.5; c.moveTo(gx2, 0); c.lineTo(gx2, h); }
  for (var la = -60; la <= 60; la += 30) { var gy2 = Math.round((90 - la) / 180 * h) + 0.5; c.moveTo(0, gy2); c.lineTo(w, gy2); }
  c.stroke();
  c.font = '10px "Segoe UI", Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.55)'; c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText('NEAR SIDE', w * 0.5, 4); c.fillText('FAR SIDE', w * 0.12, 4); c.fillText('FAR SIDE', w * 0.88, 4);
  c.strokeStyle = '#6EB4F5'; c.lineWidth = 1.3; c.beginPath();
  var cw = w / 360, ch = h / 180;
  for (var j = 0; j < 180; j++) for (var i = 0; i < 360; i++) { var id = j * 360 + i;
    if (i < 359 && ev[id] !== ev[id + 1]) { c.moveTo((i + 1) * cw, j * ch); c.lineTo((i + 1) * cw, (j + 1) * ch); }
    if (j < 179 && ev[id] !== ev[id + 360]) { c.moveTo(i * cw, (j + 1) * ch); c.lineTo((i + 1) * cw, (j + 1) * ch); } }
  c.stroke();
  function sp(v) { return { lat: Math.asin(clamp(v[2], -1, 1)) * R2D, lon: Math.atan2(v[1], v[0]) * R2D }; }
  var se = sp(earth), ss2 = sp(sun);
  var ex = (se.lon + 180) / 360 * w, ey = (90 - se.lat) / 180 * h;
  c.strokeStyle = '#6EB4F5'; c.lineWidth = 2; c.beginPath(); c.arc(ex, ey, 6, 0, 6.2832); c.moveTo(ex - 10, ey); c.lineTo(ex + 10, ey); c.moveTo(ex, ey - 10); c.lineTo(ex, ey + 10); c.stroke();
  var sx = (ss2.lon + 180) / 360 * w, sy = (90 - ss2.lat) / 180 * h;
  c.fillStyle = '#F5C45A'; c.beginPath(); c.arc(sx, sy, 5.5, 0, 6.2832); c.fill();
  c.font = '11px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle';
  SITES.forEach(function (s, idx) {
    var x = (s.lon + 180) / 360 * w, y = (90 - s.lat) / 180 * h, sel = idx === S.sel;
    c.beginPath(); c.arc(x, y, sel ? 6 : 3.5, 0, 6.2832); c.fillStyle = siteState(s) === 2 ? '#47C98D' : '#0B0F15'; c.fill();
    c.lineWidth = sel ? 2.5 : 1.2; c.strokeStyle = '#fff'; c.stroke();
    if (sel) {
      var txt = s.name.split(',')[0], tw = c.measureText(txt).width, right = x + 10 + tw < w - 4;
      c.textAlign = right ? 'left' : 'right'; var tx = right ? x + 9 : x - 9, ty = Math.min(y, h - 8);
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,10,14,.85)'; c.strokeText(txt, tx, ty); c.fillStyle = '#fff'; c.fillText(txt, tx, ty);
    }
  });
}

/* ---------- south-pole map (polar stereographic; x right = 90E, y up = 0E) ---------- */
var polarBase = null, PR = 2 * RM * 1000;
function polarXY(lat, lon) { var r = PR * Math.tan((90 + lat) / 2 * D2R); return [r * Math.sin(lon * D2R), r * Math.cos(lon * D2R)]; }
function buildPolarBase() {
  var n = POLAR.n, sh = LWB.b64bytes(POLAR.shade), il = LWB.b64bytes(POLAR.illum);
  polarBase = document.createElement('canvas'); polarBase.width = n; polarBase.height = n;
  var o = polarBase.getContext('2d'), img = o.createImageData(n, n), d = img.data;
  for (var i = 0; i < n * n; i++) {
    // amber where the 18.6-year average sunlight is high (about 30 % and up at this 960 m scale), blue-black where it is zero
    var s = sh[i] / 255, v = il[i] / 255, a = clamp((v - 0.26) / 0.2, 0, 1), g = (26 + 150 * s) * (v < 0.01 ? 0.45 : 1);
    a = a * a * (3 - 2 * a) * 0.85;
    d[i*4] = g * (1 - a) + (70 + 185 * s) * a; d[i*4+1] = g * (1 - a) + (48 + 140 * s) * a; d[i*4+2] = (g + 8) * (1 - a) + (20 + 60 * s) * a; d[i*4+3] = 255;
  }
  o.putImageData(img, 0, 0);
}
/* Base layer of the south-pole maps: the LROC WAC image (data/imagery.json) or the PGDA 18.6-year average
   sunlight over LOLA relief (data/polar.json). Both cover the same +-149.76 km polar stereographic square. */
var imgBase = null, imgBaseReady = false, BASE = 'img';
try { BASE = localStorage.getItem('lwb.base') === 'sun' ? 'sun' : 'img'; } catch (x) {}
if (IMAGERY) { imgBase = new Image(); imgBase.onload = function () { imgBaseReady = true; if (mapsShowing()) drawPolar(); else if (S.view === 'find') drawFmap(); }; imgBase.src = 'data:image/jpeg;base64,' + IMAGERY.jpeg; }
function baseLayer() {
  if (BASE === 'img' && imgBaseReady) return { src: imgBase, n: IMAGERY.n };
  if (!polarBase) buildPolarBase();
  return { src: polarBase, n: POLAR.n };
}
function setBase(b) {
  BASE = b === 'sun' ? 'sun' : 'img';
  try { localStorage.setItem('lwb.base', BASE); } catch (x) {}
  Array.prototype.forEach.call(document.querySelectorAll('.baseSel'), function (s) { s.value = BASE; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-base]'), function (el) { el.hidden = el.getAttribute('data-base') !== BASE; });
  if (mapsShowing()) drawPolar(); else if (S.view === 'find') drawFmap();
}
Array.prototype.forEach.call(document.querySelectorAll('.baseSel'), function (s) { s.addEventListener('change', function () { setBase(s.value); }); });
var polarGeom = null;
function drawPolar() {
  var cv = $('polar'), w0 = cv.clientWidth || 400;
  cv.style.height = w0 + 'px';
  var F = fit(cv, w0), c = F.c, w = F.w, half = POLAR.half_m, sc = w / (2 * half);
  function X(x) { return w / 2 + x * sc; } function Y(y) { return w / 2 - y * sc; }
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(baseLayer().src, 0, 0, w, w);
  c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 1; c.font = '10px "Segoe UI", Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'left'; c.textBaseline = 'bottom';
  [-88, -86].forEach(function (la) { var r = PR * Math.tan((90 + la) / 2 * D2R) * sc; c.beginPath(); c.arc(w / 2, w / 2, r, 0, 6.2832); c.stroke(); c.fillText(Math.abs(la) + '°S', w / 2 + 3, w / 2 - r - 2); });
  c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, w); c.moveTo(0, w / 2); c.lineTo(w, w / 2); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('0° (Earth side)', w / 2, 4);
  c.textBaseline = 'bottom'; c.fillText('180° (far side)', w / 2, w - 4);
  c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText('90°E', w - 4, w / 2 - 8); c.textAlign = 'left'; c.fillText('90°W', 4, w / 2 - 8);
  // Sun and Earth: direction of the sub-solar and sub-Earth longitude, drawn on the rim
  var D = LWB.dirs(S.tMs, _dm);
  function rim(v, col, lab) {
    var lon = Math.atan2(v[1], v[0]), ux = Math.sin(lon), uy = Math.cos(lon), R = w / 2 - 16;
    var x = w / 2 + ux * R, y = w / 2 - uy * R;
    c.strokeStyle = col; c.globalAlpha = 0.35; c.lineWidth = 1.2; c.setLineDash([4, 5]); c.beginPath(); c.moveTo(w / 2, w / 2); c.lineTo(x, y); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 7, 0, 6.2832); c.fill();
    c.strokeStyle = '#0B0F15'; c.lineWidth = 1.5; c.stroke();
    c.font = '600 10px "Segoe UI", Arial, sans-serif'; c.fillStyle = '#0B0F15'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(lab, x, y + 0.5);
  }
  rim(D.sun, '#F2B24B', 'S'); rim(D.earth, '#6FB3F2', 'E');
  c.font = '11px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle';
  var pts = [], boxes = [];
  SITES.map(function (s, idx) { return idx; }).sort(function (a, b) { return (b === S.sel) - (a === S.sel); }).forEach(function (idx) {
    var s = SITES[idx];
    if (s.lat > -84.9) return;
    var p = polarXY(s.lat, s.lon), x = X(p[0]), y = Y(p[1]), sel = idx === S.sel, st = siteState(s);
    pts.push({ idx: idx, x: x, y: y });
    c.beginPath(); c.arc(x, y, sel ? 6.5 : 4.5, 0, 6.2832); c.fillStyle = noTerrainPolar(s) ? '#5E6878' : st === 2 ? '#47C98D' : st === 1 ? '#F2B24B' : '#0B0F15'; c.fill();
    c.lineWidth = sel ? 2.5 : 1.3; c.strokeStyle = '#fff'; c.stroke();
    if (sel || w > 420) {
      var txt = s.name.split(',')[0].replace('Shackleton-de Gerlache ', ''), tw = c.measureText(txt).width, right = x + 10 + tw < w - 4;
      c.textAlign = right ? 'left' : 'right'; var tx = right ? x + 9 : x - 9, bx = right ? tx : tx - tw;
      if (boxes.some(function (q) { return bx < q[0] + q[2] + 4 && bx + tw + 4 > q[0] && Math.abs(q[1] - y) < 13; })) return;
      boxes.push([bx, y, tw]);
      c.globalAlpha = sel ? 1 : 0.8; c.lineWidth = 3; c.strokeStyle = 'rgba(8,10,14,.85)'; c.strokeText(txt, tx, y); c.fillStyle = '#fff'; c.fillText(txt, tx, y); c.globalAlpha = 1;
    }
  });
  polarGeom = { w: w, sc: sc, pts: pts };
}

/* ---------- elevation chart ---------- */
function niceStep(range) { var o = [1, 2, 5, 10, 15, 20, 30, 45]; for (var k = 0; k < o.length; k++) if (range / o[k] <= 7) return o[k]; return 45; }
/* ---------- skyline: horizon profile with the Sun's and Earth's paths (why small changes matter) ---------- */
var LUNATION_STEPS = Math.round(29.53 * PER_DAY), hzGeom = null;
/* Sun-centre elevation range per 5 deg of azimuth over the next year (3 h sampling). */
function yearBand(s) {
  var key = S.hobs + ':' + S.startMs;
  if (s.band && s.band.key === key) return s.band;
  var nb = 72, lo = new Float32Array(nb).fill(99), hi = new Float32Array(nb).fill(-99), d = LWB.newDirs(), t = {}, mn = 99, mx = -99;
  for (var k = 0; k < 2920; k++) {
    LWB.dirs(S.startMs + k * 3 * 3600000, d); LWB.topo(s.geo, d.sun, t);
    var b = Math.floor(t.az / 5) % nb;
    if (t.el < lo[b]) lo[b] = t.el; if (t.el > hi[b]) hi[b] = t.el;
    if (t.el < mn) mn = t.el; if (t.el > mx) mx = t.el;
  }
  s.band = { key: key, nb: nb, lo: lo, hi: hi, min: mn, max: mx };
  return s.band;
}
function drawHorizon() {
  var s = SITES[S.sel], g = s.geo, F = fit($('hz'), 300), c = F.c, w = F.w, h = F.h;
  var L = 40, R = 10, T = 10, Bm = 24, pw = w - L - R, ph = h - T - Bm, i0 = stepOf(S.tMs), i1 = Math.min(S.N, i0 + LUNATION_STEPS), i, k;
  var band = yearBand(s), polar = Math.abs(s.lat) > 75, lo, hi;
  var eLo = 99, eHi = -99, sLo = 99, sHi = -99;
  for (i = i0; i < i1; i += 6) { eLo = Math.min(eLo, s.earthEl[i]); eHi = Math.max(eHi, s.earthEl[i]); sLo = Math.min(sLo, s.sunEl[i]); sHi = Math.max(sHi, s.sunEl[i]); }
  if (polar) { lo = Math.min(g.hMin, band.min, -1) - 0.6; hi = Math.max(g.hMax, band.max, eHi > 0 ? Math.min(eHi, 14) : 0, 2) + 0.8; }
  else { lo = Math.max(-30, Math.min(-5, g.hMin - 2)); hi = Math.min(90, Math.max(sHi, eHi, g.hMax) + 6); }
  var st = niceStep(hi - lo);
  function X(az) { return L + az / 360 * pw; } function Y(v) { return T + (hi - v) / (hi - lo) * ph; }
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  // the Sun's range over a year
  c.fillStyle = 'rgba(' + C2.sunRGB + ',0.2)';
  for (k = 0; k < band.nb; k++) if (band.hi[k] > -90) c.fillRect(X(k * 5), Y(band.hi[k]), pw / band.nb + 0.5, Math.max(1, Y(band.lo[k]) - Y(band.hi[k])));
  // current disks, drawn before the terrain so the skyline hides what it should
  var Lk = LWB.look(g, S.tMs);
  function disk(az, el, rad, col) { c.fillStyle = col; c.beginPath(); c.ellipse(X(az), Y(el), Math.max(2.5, rad / Math.max(Math.cos(el * D2R), 0.05) / 360 * pw), Math.max(2.5, rad / (hi - lo) * ph), 0, 0, 6.2832); c.fill(); }
  disk(Lk.earthAz, Lk.earthEl, Lk.earthRad, C2['--earth']); disk(Lk.sunAz, Lk.sunEl, Lk.sunRad, C2['--disk']);
  // terrain
  var nseg = g.mask ? g.mask.length : 2;
  c.beginPath(); c.moveTo(L, T + ph + 2);
  for (k = 0; k <= nseg; k++) { var az = k / nseg * 360; c.lineTo(X(az), Y(LWB.horizonAt(g, az % 360))); }
  c.lineTo(L + pw, T + ph + 2); c.closePath(); c.fillStyle = C2['--terrain']; c.fill();
  var dist = s.terr && s.terr.dist && S.hobs === TERRAIN.meta.hobs_m[0] ? (s.terr.dd || (s.terr.dd = LWB.b64u16(s.terr.dist))) : null;
  c.lineWidth = 1.6;
  if (g.mask) {
    for (var pass = 0; pass < 2; pass++) { // far terrain first, near terrain on top
      c.strokeStyle = pass ? C2['--near'] : C2['--far']; c.beginPath();
      for (k = 0; k < nseg; k++) {
        var near = dist ? dist[k] * 10 < 5000 : false;
        if ((pass === 1) !== near) continue;
        c.moveTo(X(k / nseg * 360), Y(g.mask[k] / 100)); c.lineTo(X((k + 1) / nseg * 360), Y(g.mask[(k + 1) % nseg] / 100));
      }
      c.stroke();
    }
  } else { c.strokeStyle = C2['--far']; c.beginPath(); c.moveTo(L, Y(g.dip)); c.lineTo(L + pw, Y(g.dip)); c.stroke(); }
  // paths over the next lunation: solid where visible, faint where the terrain hides it
  function path(azA, elA, vis, col, lw) {
    for (var pass2 = 0; pass2 < 2; pass2++) {
      c.strokeStyle = col; c.lineWidth = pass2 ? lw : 1; c.globalAlpha = pass2 ? 1 : 0.35; c.beginPath();
      for (var q = i0; q + 3 < i1; q += 3) {
        if (vis(q) !== (pass2 === 1) || Math.abs(azA[q + 3] - azA[q]) > 180) continue;
        c.moveTo(X(azA[q]), Y(elA[q])); c.lineTo(X(azA[q + 3]), Y(elA[q + 3]));
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  path(s.earthAz, s.earthEl, function (q) { return s.earthMar[q] > 0; }, C2['--earth'], 1.8);
  path(s.sunAz, s.sunEl, function (q) { return s.sunFrac[q] > 0; }, C2['--sun'], 2);
  c.strokeStyle = C2['--ink']; c.lineWidth = 1.2;
  c.beginPath(); c.arc(X(Lk.sunAz), Y(Lk.sunEl), 6, 0, 6.2832); c.stroke();
  c.beginPath(); c.arc(X(Lk.earthAz), Y(Lk.earthEl), 6, 0, 6.2832); c.stroke();
  c.restore();
  // axes
  c.font = '10px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right';
  for (var v = Math.ceil(lo / st) * st; v <= hi; v += st) { c.strokeStyle = v === 0 ? C2['--zero'] : C2['--gridline']; c.lineWidth = 1; c.beginPath(); c.moveTo(L, Math.round(Y(v)) + 0.5); c.lineTo(L + pw, Math.round(Y(v)) + 0.5); c.stroke(); c.fillStyle = C2['--mute']; c.fillText(v + '°', L - 5, Y(v)); }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (var a2 = 0; a2 <= 360; a2 += 45) { c.fillStyle = C2['--line']; c.fillRect(Math.round(X(a2)), T + ph, 1, 4); c.fillStyle = a2 % 90 ? C2['--faint'] : C2['--mute']; if (a2 % 90 === 0 || w > 520) c.fillText(a2 % 90 === 0 ? COMPASS[(a2 / 45) % 8] + ' ' + a2 + '°' : a2 + '°', clamp(X(a2), L + 14, L + pw - 16), T + ph + 7); }
  c.font = '500 10px "Segoe UI", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
  c.fillStyle = C2['--sun']; c.fillText('Sun', clamp(X(Lk.sunAz) + 9, L, L + pw - 24), clamp(Y(Lk.sunEl) - 4, T + 12, T + ph));
  c.fillStyle = C2['--earth']; c.fillText('Earth', clamp(X(Lk.earthAz) + 9, L, L + pw - 34), clamp(Y(Lk.earthEl) - 4, T + 12, T + ph));
  hzGeom = { L: L, pw: pw, dist: dist };
}
function horizonNote() {
  var s = SITES[S.sel], g = s.geo, b = yearBand(s), i0 = stepOf(S.tMs), i1 = Math.min(S.N, i0 + LUNATION_STEPS), eLo = 99, eHi = -99;
  for (var i = i0; i < i1; i += 6) { eLo = Math.min(eLo, s.earthEl[i]); eHi = Math.max(eHi, s.earthEl[i]); }
  var t = '';
  if (Math.abs(s.lat) > 80) {
    t = 'Near the pole the Sun never rises or sets the way it does on Earth. It circles the whole horizon once every 29.5 days, and because the Moon\'s spin axis is tilted only 1.54° to the ecliptic, its centre stays between <b>' + deg(b.min) + '</b> and <b>' + deg(b.max) + '</b> here over the next year. The Sun\'s disk is ' + (LWB.look(g, S.tMs).sunRad * 2).toFixed(2) + '° wide. ';
    if (g.mask) t += 'The skyline it has to clear runs from <b>' + deg(g.hMin) + '</b> to <b>' + deg(g.hMax) + '</b>, so a ridge a fraction of a degree high, even one 100 km away, decides between day and night. ';
    else t += 'This site has no terrain mask, so the horizon shown is a smooth sphere and real results will differ. ';
    t += 'Earth does not circle: it wobbles inside a small box as the Moon librates, between <b>' + deg(eLo) + '</b> and <b>' + deg(eHi) + '</b> this month. ';
    var hs = heightSensitivity(s);
    if (hs) t += Math.abs(hs.a - hs.b) < 0.005 ? 'In the next ' + S.horizonD + ' days the sunlit share is <b>' + pct(hs.a) + '</b> whether the observer is 2 m or 10 m above the ground; try another season or a neighbouring site to see it change.' : 'Raising the observer from 2 m to 10 m changes the sunlit share of the next ' + S.horizonD + ' days from <b>' + pct(hs.a) + '</b> to <b>' + pct(hs.b) + '</b>.';
  } else {
    t = 'Away from the poles the Sun crosses the sky once per lunar day of 29.5 Earth days: about two weeks of light, then two weeks of night. Earth stays almost fixed in the sky (here between <b>' + deg(eLo) + '</b> and <b>' + deg(eHi) + '</b> this month) because the Moon keeps one face toward it; the small loop is libration. ';
    t += s.terr ? 'The skyline comes from the 240 m LOLA grid, so only regional relief is included.' : 'No terrain is modelled for this site: the horizon is a smooth sphere seen from ' + S.hobs + ' m, ' + deg2(g.dip) + '.';
  }
  $('hzNote').innerHTML = t;
}
/* Sunlit share of the scored period at 2 m and at 10 m (terrain sites), cached per site, day and period. */
function heightSensitivity(s) {
  var t = s.terr; if (!t || !t.mask['2'] || !t.mask['10']) return null;
  var key = Math.floor(S.tMs / DAY) + ':' + S.horizonD;
  if (s.hs && s.hs.key === key) return s.hs;
  var ser = LWB.series(S.tMs, S.horizonD, 60), out = { key: key };
  [['a', 2], ['b', 10]].forEach(function (p) {
    var q = LWB.makeSite(s.lat, s.lon, t.h_m + p[1], LWB.b64i16(t.mask[String(p[1])]), p[1]);
    out[p[0]] = LWB.metricsFrom(q, ser, S.linkMin).litFrac;
  });
  s.hs = out;
  return out;
}
$('hz').addEventListener('pointermove', function (e) {
  if (!hzGeom) return;
  var r = this.getBoundingClientRect(), az = clamp((e.clientX - r.left - hzGeom.L) / hzGeom.pw, 0, 0.99999) * 360, s = SITES[S.sel], g = s.geo;
  var txt = 'Skyline toward ' + az.toFixed(1) + '° (' + compass16(az) + '): ' + deg2(LWB.horizonAt(g, az));
  if (g.mask && hzGeom.dist) { var dm = hzGeom.dist[Math.round(az / 360 * g.mask.length) % g.mask.length] * 10; txt += ', set by terrain ' + (dm < 1000 ? Math.round(dm) + ' m' : (dm / 1000).toFixed(dm < 10000 ? 1 : 0) + ' km') + ' away'; }
  else if (!g.mask) txt += ' (smooth sphere)';
  $('hzRead').textContent = txt;
});
