/* ================= if the landing date moves ================= */
/* The statement's schedule-slip case, on the Site view: the same site, the same length of stay, a different
   landing date. Chart: one landing date every 12 h across the period, each evaluated on its own hourly series
   (LWB.metricsFrom, the routine the finder and the trade-off plot use). Table: the dial time and fixed slips
   after it. No new quantity is defined here. Sunlit means any part of the Sun in view; the link follows the
   user's communication settings (direct line of sight, ground antennas, relay satellites; 12-comms.js). */
var SLIP = { key: null, pts: null, geom: null, timer: null, hover: -1 };
var SLIP_DAYS = [0, 1, 2, 3, 5, 7, 14, 28];
var SLIP_ROWS = [['irr', 'Mean irradiance', '--sun', wm2], ['dark', 'Longest darkness', '--far', fmtHours], ['earth', 'Earth link', '--earth', pct]];
function slipMetrics(s, t0) { var ser = LWB.series(t0, S.horizonD, 60), cm = commsFor(ser); return LWB.metricsFrom(s.geo, ser, S.linkMin, cm && cm.gate, cm && cm.relay); }
function slipKey(s) { return [siteKey(s), S.startMs, S.spanD, S.horizonD, S.linkMin, maskHeight(s), commsKey()].join(':'); }
function slipCompute() {
  var s = SITES[S.sel], key = slipKey(s);
  $('slipH').textContent = 'If the landing date moves: a ' + S.horizonD + '-day stay at ' + s.name;
  $('slipNote').textContent = 'Every landing date is evaluated on its own hourly series over the statistics length (' + S.horizonD + ' days, set under Analysis period). The chart has one landing date every 12 h across the period. Sunlit means any part of the Sun in view. ' + linkRuleText() + ' Irradiance is on a Sun-facing surface.';
  slipTable();
  if (SLIP.key === key && SLIP.pts) { drawSlip(); return; }
  SLIP.pts = null; SLIP.key = null; drawSlip();
  clearTimeout(SLIP.timer);
  if (noTerrainPolar(s)) return;
  SLIP.timer = setTimeout(function () {
    if (SITES[S.sel] !== s || slipKey(s) !== key) return;
    var pts = [];
    for (var d = 0; d < S.spanD * 2; d++) { var t0 = S.startMs + d * DAY / 2, m = slipMetrics(s, t0); pts.push({ t: t0, irr: m.irrAvg, dark: m.darkMaxH, earth: m.earthFrac }); }
    SLIP.pts = pts; SLIP.key = key; drawSlip();
  }, 60);
}
function slipReadDefault() {
  var pts = SLIP.pts; if (!pts) { $('slipRead').textContent = ''; return; }
  var lo = pts[0], hi = pts[0];
  pts.forEach(function (p) { if (p.irr < lo.irr) lo = p; if (p.irr > hi.irr) hi = p; });
  $('slipRead').textContent = 'Landing between ' + fmtDay(pts[0].t) + ' and ' + fmtDay(pts[pts.length - 1].t) + ': mean irradiance over the stay runs from ' + wm2(lo.irr) + ' (landing ' + fmtDT(lo.t) + ') to ' + wm2(hi.irr) + ' (landing ' + fmtDT(hi.t) + '). Click the chart to go to a date.';
}
function drawSlip() {
  var rh = 76, F = fit($('slip'), SLIP_ROWS.length * rh + 22), c = F.c, w = F.w, L = 8, R = 8, pw = w - L - R, pts = SLIP.pts;
  c.font = '10px "Segoe UI", Arial, sans-serif'; c.textAlign = 'left';
  if (!pts) { c.fillStyle = C2['--mute']; c.textBaseline = 'top'; c.fillText(noTerrainPolar(SITES[S.sel]) ? 'No terrain model for this point, so no numbers are shown.' : 'Computing…', L, 8); SLIP.geom = null; slipReadDefault(); return; }
  var t0 = pts[0].t, t1 = pts[pts.length - 1].t, bot = SLIP_ROWS.length * rh;
  function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
  SLIP_ROWS.forEach(function (r, k) {
    var y0 = k * rh + 22, ph = rh - 30, lo = Infinity, hi = -Infinity, key = r[0];
    pts.forEach(function (p) { if (p[key] < lo) lo = p[key]; if (p[key] > hi) hi = p[key]; });
    var flat = hi - lo < 1e-9;
    function Y(v) { return flat ? y0 + ph / 2 : y0 + ph - (v - lo) / (hi - lo) * ph; }
    c.strokeStyle = C2['--line']; c.lineWidth = 1; c.beginPath(); c.moveTo(L, y0 + ph + 3.5); c.lineTo(L + pw, y0 + ph + 3.5); c.stroke();
    c.beginPath(); pts.forEach(function (p, i) { if (i) c.lineTo(X(p.t), Y(p[key])); else c.moveTo(X(p.t), Y(p[key])); });
    c.strokeStyle = C2[r[2]]; c.lineWidth = 1.8; c.stroke();
    c.lineTo(X(t1), y0 + ph + 3); c.lineTo(X(t0), y0 + ph + 3); c.closePath(); c.globalAlpha = 0.1; c.fillStyle = C2[r[2]]; c.fill(); c.globalAlpha = 1;
  });
  c.textBaseline = 'top';
  var stepD = [1, 2, 5, 7, 10, 15, 30].filter(function (d) { return S.spanD / d <= Math.max(3, Math.floor(w / 80)); })[0] || 30;
  for (var d = 0; d < S.spanD; d += stepD) { var tx = X(S.startMs + d * DAY); c.fillStyle = C2['--line']; c.fillRect(Math.round(tx), bot - 4, 1, 5); c.fillStyle = C2['--mute']; c.fillText(fmtDay(S.startMs + d * DAY), tx + 3, bot + 6); }
  function mark(t, col, lw) { var x = X(clamp(t, t0, t1)); c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x, 6); c.lineTo(x, bot); c.stroke(); }
  if (SLIP.hover >= 0 && pts[SLIP.hover]) mark(pts[SLIP.hover].t, C2['--faint'], 1);
  mark(S.tMs, C2['--ink'], 1.5);
  // row labels last, with a halo, so the time marker never runs through them
  c.textBaseline = 'bottom'; c.lineJoin = 'round';
  SLIP_ROWS.forEach(function (r, k) {
    var y0 = k * rh + 22, lo = Infinity, hi = -Infinity; pts.forEach(function (p) { if (p[r[0]] < lo) lo = p[r[0]]; if (p[r[0]] > hi) hi = p[r[0]]; });
    var t = r[1] + (hi - lo < 1e-9 ? ': ' + r[3](lo) + ' on every date' : ': ' + r[3](lo) + ' to ' + r[3](hi));
    c.lineWidth = 4; c.strokeStyle = C2['--panel']; c.strokeText(t, L + 14, y0 - 6); c.fillStyle = C2['--mute']; c.fillText(t, L + 14, y0 - 6);
  });
  SLIP.geom = { L: L, pw: pw, t0: t0, t1: t1 };
  if (SLIP.hover < 0) slipReadDefault();
}
function slipIndex(e, cv) {
  var g = SLIP.geom; if (!g || !SLIP.pts) return -1;
  var r = cv.getBoundingClientRect(), u = clamp((e.clientX - r.left - g.L) / g.pw, 0, 1);
  return Math.round(u * (SLIP.pts.length - 1));
}
$('slip').addEventListener('pointermove', function (e) {
  var i = slipIndex(e, this); if (i < 0) return;
  SLIP.hover = i; drawSlip();
  var p = SLIP.pts[i];
  $('slipRead').textContent = 'Landing ' + fmtDT(p.t) + ': mean irradiance ' + wm2(p.irr) + ', longest darkness ' + fmtHours(p.dark) + ', Earth link ' + pct(p.earth) + ' over the next ' + S.horizonD + ' days. Click to go there.';
});
$('slip').addEventListener('pointerleave', function () { SLIP.hover = -1; drawSlip(); });
$('slip').addEventListener('click', function (e) { var i = slipIndex(e, this); if (i >= 0) { SLIP.hover = -1; gotoTime(SLIP.pts[i].t); } });
function slipTable() {
  var s = SITES[S.sel], tb = $('slipTable');
  if (noTerrainPolar(s)) { tb.innerHTML = ''; return; }
  var h = '<tr><th>Landing</th><th>Mean irradiance</th><th>Sun in view</th><th>Sunlit after landing for</th><th>Longest darkness</th><th>Earth link</th><th>Longest outage</th></tr>';
  SLIP_DAYS.forEach(function (d) {
    var t = S.tMs + d * DAY, m = slipMetrics(s, t);
    h += '<tr data-t="' + t + '"' + (d === 0 ? ' class="sel"' : ' title="Go to this date"') + '><td>' + (d === 0 ? 'Current time' : 'Slip ' + d + (d === 1 ? ' day' : ' days')) + '<br><span class="mu">' + fmtDT(t) + '</span></td><td>' + wm2(m.irrAvg) + '</td><td>' + pct(m.litFrac) + '</td><td>' +
      (m.sunFrac0 > 0 ? (m.capped ? 'the whole stay' : fmtHours(m.sunsetH)) : 'dark at landing') + '</td><td>' + fmtHours(m.darkMaxH) + '</td><td>' + pct(m.earthFrac) + '</td><td>' + fmtHours(m.outMaxH) + '</td></tr>';
  });
  tb.innerHTML = h;
}
$('slipTable').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-t]'); if (tr && !tr.classList.contains('sel')) gotoTime(+tr.getAttribute('data-t')); });
