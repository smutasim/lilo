/* ================= the year ahead: every site, every day ================= */
/* Answers "when could we land, and where, if the date slips": for each site and each of the next 365 days,
   the mean visible fraction of the Sun and the share of the day Earth meets the link limit, from hourly samples
   against the site's horizon. Sites near the pole without terrain are not drawn. */
var YEAR = { key: null, busy: false, geom: null, days: 365 };
// every site by position and terrain, so adding one after removing another still recomputes
function yearKey() { return [S.startMs, S.hobs, S.linkMin, SITES.map(function (s) { return siteKey(s) + (s.terr ? 't' : ''); }).join('|')].join(':'); }
function yearRow(s, ser, key) {
  if (s.year && s.year.key === key) return;
  var n = YEAR.days, sun = new Float32Array(n), lit = new Float32Array(n), earth = new Float32Array(n), g = s.geo, v = [0, 0, 0], t = {};
  for (var d = 0; d < n; d++) {
    var a = 0, b = 0, e = 0;
    for (var h = 0; h < 24; h++) {
      var i = (d * 24 + h) * 3;
      v[0] = ser.sun[i]; v[1] = ser.sun[i+1]; v[2] = ser.sun[i+2]; LWB.topo(g, v, t);
      var f = LWB.diskFrac(g, t.az, t.el, Math.asin(LWB.R_SUN / t.range) * R2D); a += f; if (f > 0) b++;
      v[0] = ser.earth[i]; v[1] = ser.earth[i+1]; v[2] = ser.earth[i+2]; LWB.topo(g, v, t);
      if (t.el - LWB.horizonAt(g, t.az) >= S.linkMin) e++;
    }
    sun[d] = a / 24; lit[d] = b / 24; earth[d] = e / 24;
  }
  s.year = { key: key, sun: sun, lit: lit, earth: earth };
}
function computeYear() {
  var key = yearKey();
  if (YEAR.key === key || YEAR.busy) return;
  YEAR.busy = true;
  setTimeout(function () {
    var ser = LWB.series(S.startMs, YEAR.days, 60), i = 0;
    YEAR.fallback = ser.src !== 'spice';
    (function next() {
      var t0 = performance.now();
      while (i < SITES.length && performance.now() - t0 < 25) { yearRow(SITES[i], ser, key); i++; }
      if (i < SITES.length) { setTimeout(next, 0); return; }
      YEAR.key = key; YEAR.busy = false; drawYear();
      if (key !== yearKey()) computeYear();
    })();
  }, 40);
}
function yearOrder() { var o = []; CATS.forEach(function (c) { SITES.forEach(function (s, i) { if (s.cat === c[0]) o.push(i); }); }); return o; }
function drawYear() {
  if (S.view !== 'list') return;
  var cv = $('year'), order = yearOrder(), rowH = 15, top = 18, h = top + order.length * rowH + 4;
  cv.style.height = h + 'px';
  var F = fit(cv, h), c = F.c, w = F.w, L = Math.round(Math.min(190, w * 0.34)), pw = w - L - 4, n = YEAR.days, key = yearKey();
  c.font = '10px "IBM Plex Mono", monospace'; c.textBaseline = 'middle';
  // month ticks
  var d0 = new Date(S.startMs), m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
  c.textAlign = 'left';
  while (m.getTime() < S.startMs + n * DAY) {
    var x = L + (m.getTime() - S.startMs) / (n * DAY) * pw;
    c.fillStyle = C2['--line']; c.fillRect(Math.round(x), top - 4, 1, h - top);
    if (x < L + pw - 22) { c.fillStyle = C2['--mute']; c.fillText(MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 ? ' ' + m.getUTCFullYear() : ''), x + 3, 7); }
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  }
  var cw = pw / n;
  order.forEach(function (idx, r) {
    var s = SITES[idx], y = top + r * rowH, sel = idx === S.sel;
    c.fillStyle = sel ? C2['--ink'] : C2['--mute']; c.font = (sel ? '600 ' : '') + '10.5px "IBM Plex Mono", monospace'; c.textAlign = 'right';
    var name = s.name.split(',')[0].replace('Shackleton-de Gerlache ', ''); while (name.length > 4 && c.measureText(name).width > L - 10) name = name.slice(0, -2);
    c.fillText(name, L - 6, y + 6);
    c.fillStyle = C2['--track']; c.fillRect(L, y, pw, rowH - 3);
    if (noTerrainPolar(s)) {
      c.save(); c.beginPath(); c.rect(L, y, pw, rowH - 3); c.clip(); c.strokeStyle = C2['--line']; c.lineWidth = 2; c.beginPath();
      for (var q = -rowH; q < pw; q += 6) { c.moveTo(L + q, y + rowH); c.lineTo(L + q + rowH, y); }
      c.stroke(); c.restore();
    } else if (s.year && s.year.key === key) {
      for (var d = 0; d < n; d++) {
        var xx = L + d * cw, v = s.year.sun[d], e = s.year.earth[d];
        if (v > 0) { c.fillStyle = 'rgba(' + C2.sunRGB + ',' + (0.12 + 0.88 * v).toFixed(2) + ')'; c.fillRect(xx, y, cw + 0.4, rowH - 6); }
        if (e > 0) { c.fillStyle = 'rgba(' + C2.earthRGB + ',' + (0.25 + 0.75 * e).toFixed(2) + ')'; c.fillRect(xx, y + rowH - 6, cw + 0.4, 3); }
      }
    }
    if (sel) { c.strokeStyle = C2['--ink']; c.lineWidth = 1; c.strokeRect(L - 0.5, y - 1.5, pw + 1, rowH); }
  });
  var tx = L + (S.tMs - S.startMs) / (n * DAY) * pw;
  if (tx >= L && tx <= L + pw) { c.fillStyle = C2['--ink']; c.fillRect(tx - 0.75, top - 4, 1.5, h - top); }
  if (YEAR.key !== key) { c.fillStyle = C2['--mute']; c.textAlign = 'left'; c.fillText('Computing…', L + 6, top + 6); }
  $('yrFrom').textContent = iso(S.startMs).slice(0, 10) + ' to ' + iso(S.startMs + n * DAY).slice(0, 10) + ', observer ' + S.hobs + ' m' + (YEAR.fallback ? ' · fallback ephemeris in part' : '');
  YEAR.geom = { L: L, pw: pw, top: top, rowH: rowH, order: order };
}
function yearCell(e, cv) {
  var G = YEAR.geom; if (!G) return null;
  var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  var row = Math.floor((y - G.top) / G.rowH), d = Math.floor((x - G.L) / G.pw * YEAR.days);
  if (row < 0 || row >= G.order.length) return null;
  return { idx: G.order[row], d: x < G.L ? -1 : clamp(d, 0, YEAR.days - 1) };
}
$('year').addEventListener('pointermove', function (e) {
  var k = yearCell(e, this), el = $('yrRead');
  if (!k) return;
  var s = SITES[k.idx];
  if (noTerrainPolar(s)) { el.textContent = s.name + ': no terrain model near the pole, so nothing is shown.'; return; }
  if (k.d < 0 || !s.year || s.year.key !== yearKey()) { el.textContent = s.name; return; }
  el.textContent = s.name + ', ' + iso(S.startMs + k.d * DAY).slice(0, 10) + ': Sun in view ' + pct(s.year.lit[k.d]) + ' of the day, mean visible disk ' + pct(s.year.sun[k.d]) + '; Earth in direct view at your link limit ' + pct(s.year.earth[k.d]) + ' of the day (relays and antennas are not applied in this overview). Click to open.';
});
$('year').addEventListener('click', function (e) {
  var k = yearCell(e, this); if (!k) return;
  if (k.d >= 0) gotoTime(S.startMs + k.d * DAY + DAY / 2);
  selectSite(k.idx); setView('site');
});
