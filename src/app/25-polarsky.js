/* ================= sky plot (polar) ================= */
/* The same quantities as "The skyline, all the way round", wrapped into a ring: azimuth runs round the plot
   (north up, east right, like a map of directions from the site) and elevation runs inward from the rim.
   Near the pole everything of interest lies within a few degrees of the horizon, so the ring is zoomed to that
   band and the middle is left empty; elsewhere the centre is the zenith. */
var polCv = $('skyPolar'), polGeom = null;
function polRange(s, i0, i1) {
  var g = s.geo, band = yearBand(s), eHi = -99, sHi = -99;
  for (var i = i0; i < i1; i += 6) { eHi = Math.max(eHi, s.earthEl[i]); sHi = Math.max(sHi, s.sunEl[i]); }
  if (Math.abs(s.lat) > 75 && !S.polFull) return { zoom: true, lo: Math.min(g.hMin, band.min, -1) - 0.5, hi: Math.max(g.hMax, band.max, eHi > 0 ? Math.min(eHi, 14) : 0, 2) + 0.8, band: band };
  return { zoom: false, lo: Math.max(-30, Math.min(-5, g.hMin - 2)), hi: 90, band: band };
}
function renderPolarSky() {
  var W = polCv.clientWidth || 600, H = polCv.clientHeight || 500, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (polCv.width !== Math.round(W * dpr) || polCv.height !== Math.round(H * dpr)) { polCv.width = Math.round(W * dpr); polCv.height = Math.round(H * dpr); }
  var c = polCv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#020306'; c.fillRect(0, 0, W, H);
  var s = SITES[S.sel], g = s.geo; if (!s.ready) return;
  var top = 30, bot = 34, availH = H - top - bot;
  var cx = W / 2, cy = top + availH / 2, R = Math.max(60, Math.min(availH / 2, W / 2 - 8) - 24);
  var i0 = stepOf(S.tMs), i1 = Math.min(S.N, i0 + LUNATION_STEPS), Q = polRange(s, i0, i1), lo = Q.lo, hi = Q.hi, r0 = Q.zoom ? R * 0.24 : 0, k;
  function rad(el) { return R - (clamp(el, lo, hi) - lo) / (hi - lo) * (R - r0); }
  function P(az, el) { var r = rad(el), a = az * D2R; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
  var pxPerDeg = (R - r0) / (hi - lo);
  // sky disc
  c.fillStyle = '#070A10'; c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.fill();
  // the Sun's range over a year, per 5 deg of azimuth
  c.fillStyle = 'rgba(242,178,75,0.16)';
  for (k = 0; k < Q.band.nb; k++) {
    if (Q.band.hi[k] < -90 || Q.band.hi[k] < lo) continue;
    var a0 = (k * 5 - 90) * D2R, a1 = ((k + 1) * 5 - 90) * D2R + 0.004;
    c.beginPath(); c.arc(cx, cy, rad(Q.band.lo[k]), a0, a1); c.arc(cx, cy, rad(Q.band.hi[k]), a1, a0, true); c.closePath(); c.fill();
  }
  // current disks first, so the terrain hides what it should
  var Lk = LWB.look(g, S.tMs);
  function disk(az, el, r, col) { if (el + r < lo) return; var p = P(az, el); c.fillStyle = col; c.beginPath(); c.arc(p[0], p[1], Math.max(3, r * pxPerDeg), 0, 6.2832); c.fill(); }
  disk(Lk.earthAz, Lk.earthEl, Lk.earthRad, '#6FB3F2'); disk(Lk.sunAz, Lk.sunEl, Lk.sunRad, '#FFE9B8');
  // terrain: everything between the rim and the skyline
  var nseg = g.mask ? g.mask.length : 180, p;
  c.beginPath();
  for (k = 0; k <= nseg; k++) { p = P(k / nseg * 360, LWB.horizonAt(g, (k / nseg * 360) % 360)); if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
  c.closePath(); c.moveTo(cx + R, cy); c.arc(cx, cy, R, 0, 6.2832, true); c.closePath();
  c.fillStyle = '#1B212B'; c.fill('evenodd');
  var dist = s.terr && s.terr.dist && S.hobs === TERRAIN.meta.hobs_m[0] ? (s.terr.dd || (s.terr.dd = LWB.b64u16(s.terr.dist))) : null;
  c.lineWidth = 1.7;
  for (var pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? '#C9A27A' : '#7E8CA3'; c.beginPath();
    for (k = 0; k < nseg; k++) {
      var near = dist && g.mask ? dist[Math.round(k / nseg * dist.length) % dist.length] * 10 < 5000 : false;
      if ((pass === 1) !== near) continue;
      var pa = P(k / nseg * 360, LWB.horizonAt(g, k / nseg * 360)), pb = P((k + 1) / nseg * 360, LWB.horizonAt(g, ((k + 1) / nseg * 360) % 360));
      c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]);
    }
    c.stroke();
  }
  // elevation rings and azimuth spokes
  var st = niceStep(hi - lo);
  c.font = '10px "Segoe UI", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineWidth = 1;
  for (var v = Math.ceil(lo / st) * st; v <= hi - (Q.zoom ? 0 : st / 2); v += st) {
    c.strokeStyle = v === 0 ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.10)'; c.beginPath(); c.arc(cx, cy, rad(v), 0, 6.2832); c.stroke();
    c.fillStyle = 'rgba(230,235,240,0.62)'; c.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°', cx + 4, cy - rad(v) + 7);
  }
  c.strokeStyle = 'rgba(255,255,255,0.10)'; c.beginPath();
  for (var az = 0; az < 360; az += 30) { var q0 = [cx + r0 * Math.sin(az * D2R), cy - r0 * Math.cos(az * D2R)], q1 = [cx + R * Math.sin(az * D2R), cy - R * Math.cos(az * D2R)]; c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]); }
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.stroke();
  c.textAlign = 'center';
  for (az = 0; az < 360; az += 30) {
    var lx = cx + (R + 14) * Math.sin(az * D2R), ly = cy - (R + 13) * Math.cos(az * D2R), major = az % 90 === 0;
    c.font = (major ? '600 12px' : '10px') + ' "Segoe UI", Arial, sans-serif';
    c.fillStyle = az === 0 ? '#F2B24B' : major ? 'rgba(230,235,240,0.9)' : 'rgba(230,235,240,0.5)';
    c.fillText(major ? COMPASS[az / 45] : az + '°', lx, ly);
  }
  // paths over the next lunation: solid where visible, faint where hidden
  function path(azA, elA, vis, col, lw) {
    for (var p2 = 0; p2 < 2; p2++) {
      c.strokeStyle = col; c.lineWidth = p2 ? lw : 1; c.globalAlpha = p2 ? 1 : 0.4; c.beginPath();
      for (var q = i0; q + 3 < i1; q += 3) {
        if (vis(q) !== (p2 === 1) || (elA[q] < lo && elA[q + 3] < lo)) continue;
        var u = P(azA[q], elA[q]), w = P(azA[q + 3], elA[q + 3]); c.moveTo(u[0], u[1]); c.lineTo(w[0], w[1]);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  path(s.earthAz, s.earthEl, function (q) { return s.earthMar[q] > 0; }, '#6FB3F2', 1.8);
  path(s.sunAz, s.sunEl, function (q) { return s.sunFrac[q] > 0; }, '#F2B24B', 2);
  // satellites: track and marker; in the zoomed ring anything above the inner ring is off the plot
  satsShown().forEach(function (q) {
    function on(t) { return t && t.el >= lo && (!Q.zoom || t.el <= hi); }
    if (q.periodH) {
      c.strokeStyle = 'rgba(195,172,248,0.55)'; c.lineWidth = 1; c.beginPath(); var pv = null;
      satTrack(s, q, 90).forEach(function (t) { var p3 = on(t) ? P(t.az, t.el) : null; if (p3 && pv) { c.moveTo(pv[0], pv[1]); c.lineTo(p3[0], p3[1]); } pv = p3; });
      c.stroke();
    }
    var t0 = satLook(s, q, S.tMs, false); if (!on(t0)) return;
    var sp = P(t0.az, t0.el);
    c.fillStyle = '#C3ACF8'; c.beginPath(); c.moveTo(sp[0], sp[1] - 5); c.lineTo(sp[0] + 5, sp[1]); c.lineTo(sp[0], sp[1] + 5); c.lineTo(sp[0] - 5, sp[1]); c.closePath(); c.fill();
    c.font = '11px "Segoe UI", Arial, sans-serif'; c.textAlign = 'left'; c.lineWidth = 3; c.strokeStyle = 'rgba(2,3,6,.85)'; c.strokeText(q.name, sp[0] + 9, sp[1]); c.fillStyle = '#E6EAF0'; c.fillText(q.name, sp[0] + 9, sp[1]);
  });
  c.font = '600 11px "Segoe UI", Arial, sans-serif'; c.textAlign = 'left';
  [[Lk.sunAz, Lk.sunEl, 'Sun', '#F2B24B'], [Lk.earthAz, Lk.earthEl, 'Earth', '#6FB3F2']].forEach(function (b) {
    var off = b[1] < lo, pp = P(b[0], b[1]);
    c.strokeStyle = '#fff'; c.lineWidth = 1.3; c.setLineDash(off ? [3, 3] : []); c.beginPath(); c.arc(pp[0], pp[1], 7, 0, 6.2832); c.stroke(); c.setLineDash([]);
    c.lineWidth = 3; c.strokeStyle = 'rgba(2,3,6,.85)'; c.strokeText(b[2] + (off ? ' (below the rim)' : ''), pp[0] + 11, pp[1]); c.fillStyle = b[3]; c.fillText(b[2] + (off ? ' (below the rim)' : ''), pp[0] + 11, pp[1]);
  });
  c.textAlign = 'center'; c.fillStyle = 'rgba(230,235,240,0.55)'; c.font = '10px "Segoe UI", Arial, sans-serif';
  if (Q.zoom) { c.fillText('zoomed to', cx, cy - 13); c.fillText(deg(lo) + ' … ' + deg(hi), cx, cy); c.fillText('zenith off scale', cx, cy + 13); }
  else { c.fillText('zenith', cx, cy + 12); c.fillRect(cx - 4, cy - 0.5, 9, 1); c.fillRect(cx - 0.5, cy - 4, 1, 9); }
  polGeom = { cx: cx, cy: cy, R: R, r0: r0, lo: lo, hi: hi, zoom: Q.zoom };
  if (!polHover) polarReadDefault();
  var fr = frame(S.tMs);
  lastSky = { sun: { az: Lk.sunAz, alt: Lk.sunEl }, earth: { az: Lk.earthAz, alt: Lk.earthEl }, earthFrac: (1 + dot(fr.sunGeoU, fr.xr)) / 2, L: Lk };
  updateHud();
}
var polHover = false;
function polarReadDefault() {
  var G = polGeom, s = SITES[S.sel]; if (!G) return;
  $('polarRead').textContent = 'North up, east right. Rim ' + deg(G.lo) + ', ' + (G.zoom ? 'inner ring ' + deg(G.hi) : 'centre is the zenith') + '. ' + (s.geo.mask ? 'Grey is terrain below the LOLA skyline.' : 'No terrain: smooth-sphere horizon.');
}
polCv.addEventListener('pointermove', function (e) {
  var G = polGeom; if (!G) return;
  var r = polCv.getBoundingClientRect(), x = e.clientX - r.left - G.cx, y = e.clientY - r.top - G.cy, d = Math.hypot(x, y);
  if (d > G.R + 4 || d < G.r0) { polHover = false; polarReadDefault(); return; }
  polHover = true;
  var az = (Math.atan2(x, -y) * R2D + 360) % 360, el = G.lo + (G.R - d) / (G.R - G.r0) * (G.hi - G.lo), hz = LWB.horizonAt(SITES[S.sel].geo, az);
  $('polarRead').textContent = 'Azimuth ' + az.toFixed(1) + '° (' + compass16(az) + '), elevation ' + deg2(el) + '. Skyline there ' + deg2(hz) + (el < hz ? ': behind terrain.' : ': open sky.');
});
polCv.addEventListener('pointerleave', function () { polHover = false; polarReadDefault(); });
function setSkyMode(m) {
  S.skyMode = m === 'polar' || m === '3d' || m === 'earth' ? m : 'sky';
  var pol = S.skyMode === 'polar', t3 = S.skyMode === '3d', sky = S.skyMode === 'sky', fe = S.skyMode === 'earth';
  skyCv.hidden = !sky; polCv.hidden = !pol; $('sky3d').hidden = !t3; $('skyEarth').hidden = !fe;
  $('polarRead').hidden = !pol; $('skyNote').hidden = !sky; $('t3Read').hidden = !t3; $('feRead').hidden = !fe;
  $('modeSky').setAttribute('aria-selected', sky ? 'true' : 'false'); $('modePolar').setAttribute('aria-selected', pol ? 'true' : 'false'); $('mode3d').setAttribute('aria-selected', t3 ? 'true' : 'false'); $('modeEarth').setAttribute('aria-selected', fe ? 'true' : 'false');
  $('lookGrp').hidden = !sky; $('t3Grp').hidden = !t3; $('polGrp').hidden = !pol; $('feGrp').hidden = !fe;
  $('vState').hidden = fe;
  if (!t3) t3HideLabels();
  kick();
}
/* Near the pole the plot is zoomed to the few degrees round the horizon where the Sun and Earth live; the whole
   sky (rim = horizon, centre = zenith) is the usual sky plot and shows satellite passes. */
$('polZoom').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  S.polFull = b.getAttribute('data-z') === 'full';
  Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
  kick();
});
$('modeSky').addEventListener('click', function () { setSkyMode('sky'); writeHash(); });
$('modePolar').addEventListener('click', function () { setSkyMode('polar'); writeHash(); });
$('mode3d').addEventListener('click', function () { setSkyMode('3d'); writeHash(); });
$('modeEarth').addEventListener('click', function () { setSkyMode('earth'); writeHash(); });
