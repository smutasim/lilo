/* ================= site list: every site of the operator in one table ================= */
/* One row per site, the same quantities as the Site view, for the statistics period that starts at the dial
   time. Grouped by kind until a column header is clicked; then sorted by that column. No column is a score. */
var LIST = { sort: null, dir: 1, rows: [], cmp: [] };
var LCOLS = [
  { k: 'irrNow', name: 'Irradiance now', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'irradiance_now_w_m2' },
  { k: 'irr', name: 'Mean', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'mean_irradiance_w_m2' },
  { k: 'day', name: 'Lowest 24 h', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'lowest_24h_mean_irradiance_w_m2' },
  { k: 'lit', name: 'Sun in view', unit: '', fmt: pct, csv: 'sun_in_view_fraction' },
  { k: 'dark', name: 'Longest dark', unit: '', fmt: fmtHours, csv: 'longest_darkness_h' },
  { k: 'earth', name: 'Earth link', unit: '', fmt: pct, csv: 'earth_link_fraction' },
  { k: 'out', name: 'Longest outage', unit: '', fmt: fmtHours, csv: 'longest_link_outage_h' },
  { k: 'slope', name: 'Slope', unit: '', fmt: function (v) { return isFinite(v) ? v.toFixed(1) + '°' : 'n/a'; }, csv: 'slope_deg' },
  { k: 'next', name: 'Constraints next met', unit: '', fmt: null, csv: 'limits_next_met_utc' }
];
function listRow(s, idx, i0) {
  var r = { idx: idx, s: s, ok: s.ready && !noTerrainPolar(s) };
  if (!r.ok) return r;
  var P = periodStats(s, i0);
  r.irrNow = LWB.look(s.geo, S.tMs).irr; r.irr = P.irrAvg; r.day = P.irrDayMin; r.lit = P.litFrac; r.dark = P.darkMaxH; r.earth = P.earthFrac; r.out = P.outMaxH; r.slope = slopeVal(s);
  r.now = s.open[i0] === 1;
  var nx = r.now ? null : s.wins.filter(function (w) { return w.t0 > S.tMs; })[0];
  r.next = r.now ? S.tMs : nx ? nx.t0 : Infinity; r.nextTxt = r.now ? 'now' : nx ? fmtDT(nx.t0) : 'not in range';
  return r;
}
/* The table shows a fixed set of columns: the quantities the Find goals use, plus Sun in view and the next time
   all limits are met. Irradiance now and the terrain source are in the CSV, which always has every column. */
var LSHOW = { irr: 1, day: 1, lit: 1, dark: 1, earth: 1, out: 1, slope: 1, next: 1 };
function updateList() {
  if (S.view !== 'list') return;
  LCOLS[5].name = linkWord();
  var i0 = stepOf(S.tMs), rows = SITES.map(function (s, idx) { return listRow(s, idx, i0); }), k = LIST.sort;
  var cols = LCOLS.filter(function (c) { return LSHOW[c.k]; }), ncol = cols.length + 4;
  LIST.rows = rows;
  $('listWhen').textContent = 'Next ' + S.horizonD + ' days from ' + fmtFull(S.tMs);
  var h = '<tr><th style="width:28px" title="Tick two sites to compare them side by side"><span class="sr">Compare</span>⇆</th><th>Site</th><th style="text-align:left">Coordinates</th>' + cols.map(function (c) { return '<th data-k="' + c.k + '"' + (k === c.k ? ' aria-sort="' + (LIST.dir > 0 ? 'ascending' : 'descending') + '"' : '') + ' title="Sort by this column">' + c.name + (c.unit ? ' <span class="mu">' + c.unit + '</span>' : '') + (k === c.k ? (LIST.dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '<th><span class="sr">Actions</span></th></tr>';
  function line(r) {
    var s = r.s, t = '<tr data-i="' + r.idx + '"' + (r.idx === S.sel ? ' class="sel"' : '') + ' title="Open ' + esc(s.name) + '"><td style="text-align:center"><input type="checkbox" data-cmp="' + r.idx + '"' + (LIST.cmp.indexOf(r.idx) >= 0 ? ' checked' : '') + ' aria-label="Compare ' + esc(s.name) + '"></td><td><span class="dot' + (r.ok && r.now ? ' on' : '') + '" title="' + (r.ok && r.now ? 'Constraints met now' : 'Constraints not met now') + '"></span>' + esc(s.name) + '</td><td class="mu" style="text-align:left">' + fmtCoord(s.lat, s.lon) + '</td>';
    if (!r.ok) t += '<td colspan="' + cols.length + '" style="text-align:left" class="mu">' + (s.ready ? 'No terrain model near the pole: numbers would be wrong, so none are shown.' : 'Computing…') + '</td>';
    else cols.forEach(function (c) { t += '<td>' + (c.k === 'next' ? r.nextTxt : c.fmt(r[c.k])) + '</td>'; });
    return t + '<td class="act">' + (s.custom ? '<button type="button" data-act="del" aria-label="Remove ' + esc(s.name) + '">×</button>' : '') + '</td></tr>';
  }
  if (k) {
    rows.slice().sort(function (a, b) { var x = a.ok && isFinite(a[k]) ? a[k] : null, y = b.ok && isFinite(b[k]) ? b[k] : null; if (x === null || y === null) return (x === null) - (y === null); return (x - y) * LIST.dir; }).forEach(function (r) { h += line(r); });
  } else CATS.forEach(function (cat) {
    var g = rows.filter(function (r) { return r.s.cat === cat[0]; }); if (!g.length) return;
    h += '<tr class="grp"><td colspan="' + ncol + '">' + cat[1] + '</td></tr>'; g.forEach(function (r) { h += line(r); });
  });
  $('listTable').innerHTML = h;
  $('listNote').innerHTML = 'Irradiance is on a Sun-facing surface (W/m²): 1361 at 1 au, scaled by the Sun\'s distance and the visible fraction of its disk. <b>Mean</b> and <b>Lowest 24 h</b> are over the statistics period; the lowest 24 h mean is the worst day a power system has to bridge. <b>' + linkWord() + '</b>: ' + esc(linkRuleText()) + ' The green dot and the last column use every constraint. Slope is the LOLA grid value, not a lander-scale slope. The exported CSV also has the irradiance now and the terrain source. The period, the constraints and the time are set in the Site view.';
  cmpRender();
}
$('listTable').addEventListener('click', function (e) {
  var ck = e.target.closest('input[data-cmp]');
  if (ck) {
    var i = +ck.getAttribute('data-cmp'), at = LIST.cmp.indexOf(i);
    if (ck.checked && at < 0) { LIST.cmp.push(i); if (LIST.cmp.length > 2) LIST.cmp.shift(); } else if (!ck.checked && at >= 0) LIST.cmp.splice(at, 1);
    Array.prototype.forEach.call(document.querySelectorAll('#listTable input[data-cmp]'), function (x) { x.checked = LIST.cmp.indexOf(+x.getAttribute('data-cmp')) >= 0; });
    cmpRender(); if (LIST.cmp.length === 2) $('cmpPanel').scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.target.closest('td') && e.target.closest('td').querySelector('input[data-cmp]')) return;
  var th = e.target.closest('th[data-k]');
  if (th) {
    var k = th.getAttribute('data-k'), lowFirst = k === 'dark' || k === 'out' || k === 'slope' || k === 'next';
    if (LIST.sort !== k) { LIST.sort = k; LIST.dir = lowFirst ? 1 : -1; } else if (LIST.dir === (lowFirst ? 1 : -1)) LIST.dir = -LIST.dir; else LIST.sort = null;
    updateList(); return;
  }
  var tr = e.target.closest('tr[data-i]'); if (!tr) return;
  var idx = +tr.getAttribute('data-i'), b = e.target.closest('button'), act = b ? b.getAttribute('data-act') : 'open';
  if (act === 'del') removeSiteAt(idx);
  else { selectSite(idx); setView('site'); }
});
/* ---------- two sites side by side for one day ---------- */
/* One calendar day (UTC, or the observer's local day when the clock is local), 10-min samples, events bisected to
   1 s: the same rules as the Site view. The better value of each pair is shaded; quantities only. */
function cmpDay0() {
  var v = $('cmpDay').value;
  if (!v) { v = toZonedInput(S.tMs).slice(0, 10); $('cmpDay').value = v; }
  return parseZoned(v + 'T00:00');
}
function cmpDayStats(s, t0) {
  var ser = LWB.series(t0, 1, 10), cm = commsFor(ser), m = LWB.metricsFrom(s.geo, ser, S.linkMin, cm && cm.gate, cm && cm.relay), g = s.geo, t1 = t0 + DAY;
  var sunE = LWB.findEdges(function (ms) { return sunOK(LWB.sunFracAt(g, ms)); }, t0, t1, 600000, 1000), earE = LWB.findEdges(function (ms) { return LWB.earthMarginAt(g, ms) >= S.linkMin; }, t0, t1, 600000, 1000);
  var smp = [], sLo = 99, sHi = -99, eLo = 99, eHi = -99;
  for (var t = t0; t <= t1; t += 600000) { var L = LWB.look(g, t); smp.push([L.sunFrac, L.earthMargin]); sLo = Math.min(sLo, L.sunEl); sHi = Math.max(sHi, L.sunEl); eLo = Math.min(eLo, L.earthEl); eHi = Math.max(eHi, L.earthEl); }
  return { m: m, sunE: sunE, earE: earE, smp: smp, sun: [sLo, sHi], earth: [eLo, eHi], slope: slopeVal(s), L0: LWB.look(g, t0) };
}
function cmpRender() {
  var body = $('cmpBody'), ids = LIST.cmp.filter(function (i) { return SITES[i]; });
  Array.prototype.forEach.call(document.querySelectorAll('.tzName'), function (el) { el.textContent = S.tz === 'local' ? tzLabel(S.tMs) + ', ' + tzZone() : 'UTC'; });
  if (ids.length < 2) { body.innerHTML = '<p class="hint">' + (ids.length ? 'Tick one more site in the table below.' : 'Tick two sites in the left-hand column of the table below to compare them for one day.') + '</p>'; $('cmpWhen').textContent = ''; return; }
  var t0 = cmpDay0(), A = SITES[ids[0]], B = SITES[ids[1]];
  if (!isFinite(t0)) return;
  $('cmpWhen').textContent = fmtDT(t0).replace(/, .*/, '') + ' ' + new Date(shiftTz(t0)).getUTCFullYear() + ', 00:00 to 24:00 ' + tzLabel(t0);
  var bad = [A, B].filter(noTerrainPolar);
  if (bad.length) { body.innerHTML = '<p class="msg stop">' + bad.map(function (s) { return esc(s.name); }).join(' and ') + ': no terrain model near the pole, so nothing is compared.</p>'; return; }
  var a = cmpDayStats(A, t0), b = cmpDayStats(B, t0);
  function ev(E, onW, offW) { return E.length ? E.map(function (e) { return (e.on ? onW : offW) + ' ' + fmtClock(e.t); }).join(', ') : 'none'; }
  var rows = [
    ['Sun in view', pct(a.m.litFrac), pct(b.m.litFrac), a.m.litFrac, b.m.litFrac, 1],
    ['Mean irradiance', wm2(a.m.irrAvg), wm2(b.m.irrAvg), a.m.irrAvg, b.m.irrAvg, 1],
    ['Longest darkness', fmtHours(a.m.darkMaxH), fmtHours(b.m.darkMaxH), a.m.darkMaxH, b.m.darkMaxH, -1],
    [linkWord(), pct(a.m.earthFrac), pct(b.m.earthFrac), a.m.earthFrac, b.m.earthFrac, 1],
    ['Longest link outage', fmtHours(a.m.outMaxH), fmtHours(b.m.outMaxH), a.m.outMaxH, b.m.outMaxH, -1],
    ['Sun elevation, lowest to highest', deg2(a.sun[0]) + ' to ' + deg2(a.sun[1]), deg2(b.sun[0]) + ' to ' + deg2(b.sun[1]), 0, 0, 0],
    ['Earth elevation, lowest to highest', deg2(a.earth[0]) + ' to ' + deg2(a.earth[1]), deg2(b.earth[0]) + ' to ' + deg2(b.earth[1]), 0, 0, 0],
    ['Sun changes (' + sunWord() + ')', ev(a.sunE, 'up', 'down'), ev(b.sunE, 'up', 'down'), 0, 0, 0],
    ['Earth changes', ev(a.earE, 'rise', 'set'), ev(b.earE, 'rise', 'set'), 0, 0, 0],
    ['Slope (LOLA grid)', slopeText(A), slopeText(B), a.slope, b.slope, isFinite(a.slope) && isFinite(b.slope) ? -1 : 0]
  ];
  var tb = '<tr><th>' + 'Quantity, this day' + '</th><th>' + esc(A.name) + '</th><th>' + esc(B.name) + '</th></tr>' + rows.map(function (r) {
    var ca = '', cb = '', d = r[5] ? (r[3] - r[4]) * r[5] : 0;
    if (r[5] && Math.abs(r[3] - r[4]) > 1e-6 * Math.max(1, Math.abs(r[3]))) { if (d > 0) ca = ' class="better"'; else cb = ' class="better"'; }
    return '<tr><td>' + r[0] + '</td><td' + ca + ' style="white-space:normal">' + r[1] + '</td><td' + cb + ' style="white-space:normal">' + r[2] + '</td></tr>';
  }).join('');
  body.innerHTML = '<div class="cmp2"><div class="col"><h3>' + esc(A.name) + '</h3><canvas id="cmpA" aria-label="24 hours at ' + esc(A.name) + '"></canvas></div><div class="col"><h3>' + esc(B.name) + '</h3><canvas id="cmpB" aria-label="24 hours at ' + esc(B.name) + '"></canvas></div></div>' +
    '<div class="tblwrap" style="margin-top:8px"><table class="cmp">' + tb + '</table></div>' +
    '<p class="hint">Shaded: the better of the two for that quantity. Rows of the strips: Sun (height = share of the disk visible) and Earth (centre at least ' + S.linkMin + '° above the skyline; relays and ground stations count in the table, not the strip). Same constraints and observer height as Site analysis.</p>';
  cmpStrip($('cmpA'), a, t0); cmpStrip($('cmpB'), b, t0);
}
function cmpStrip(cv, d, t0) {
  var F = fit(cv, 110), c = F.c, w = F.w, h = F.h, L = 44, R = 8, pw = w - L - R, n = d.smp.length - 1, rows = [['Sun', 0], ['Earth', 1]];
  c.clearRect(0, 0, w, h); c.font = '11px "Segoe UI", Arial, sans-serif'; c.textBaseline = 'middle';
  rows.forEach(function (r, k) {
    var y = 10 + k * 36, bh = 26;
    c.fillStyle = C2['--track']; c.fillRect(L, y, pw, bh); c.fillStyle = C2['--mute']; c.textAlign = 'right'; c.fillText(r[0], L - 6, y + bh / 2);
    for (var i = 0; i < n; i++) {
      var v = d.smp[i][r[1]], x0 = L + i / n * pw, x1 = L + (i + 1) / n * pw;
      if (r[1] === 0 && v > 0) { c.fillStyle = C2['--disk']; c.fillRect(x0, y + bh * (1 - v), x1 - x0 + 0.5, bh * v); }
      if (r[1] === 1 && v >= S.linkMin) { c.fillStyle = C2['--earth']; c.fillRect(x0, y, x1 - x0 + 0.5, bh); }
    }
  });
  c.fillStyle = C2['--mute']; c.textAlign = 'center'; c.textBaseline = 'top';
  for (var hh = 0; hh <= 24; hh += 3) { var x = L + hh / 24 * pw; c.fillRect(x, 82, 1, 4); c.fillText(pad(hh) + ':00', clamp(x, L + 14, L + pw - 14), 88); }
}
$('cmpDay').addEventListener('change', cmpRender);
$('cmpPrev').addEventListener('click', function () { var t = cmpDay0() - DAY / 2; $('cmpDay').value = toZonedInput(t).slice(0, 10); cmpRender(); });
$('cmpNext').addEventListener('click', function () { var t = cmpDay0() + DAY * 1.5; $('cmpDay').value = toZonedInput(t).slice(0, 10); cmpRender(); });
$('cmpClear').addEventListener('click', function () { LIST.cmp = []; updateList(); cmpRender(); });
function listCSV() {
  var L = ['# LILO (Lunar Illumination and Landing Optimizer), site list. Not flight-grade.', '# period: ' + S.horizonD + ' days from ' + iso(S.tMs), '# limits: ' + limitsList().join('; '), '# irradiance: W/m2 on a Sun-facing surface; 1361 W/m2 at 1 au (IAU 2015 Resolution B3) x (1 au / Sun distance)^2 x visible fraction of the solar disk',
    '# ephemeris: ' + (STEPS.fallback ? 'astronomy-engine fallback in part' : 'SPICE DE440, MOON_ME') + ' | observer height ' + S.hobs + ' m where a mask exists | 10-min samples'];
  L.push(['name', 'lat_deg', 'lon_east_deg', 'terrain', 'limits_met_now'].concat(LCOLS.map(function (c) { return c.csv; })).join(','));
  LIST.rows.forEach(function (r) {
    var s = r.s, a = ['"' + s.name.replace(/"/g, '""') + '"', s.lat.toFixed(5), ((s.lon + 360) % 360).toFixed(5), '"' + terrLabel(s) + '"'];
    if (!r.ok) a.push('no usable terrain');
    else { a.push(r.now ? 1 : 0); LCOLS.forEach(function (c) { var v = r[c.k]; a.push(c.k === 'next' ? (isFinite(v) ? iso(v) : '') : c.k === 'lit' || c.k === 'earth' ? v.toFixed(4) : isFinite(v) ? (+v.toFixed(2)) : ''); }); }
    L.push(a.join(','));
  });
  return L.join('\n');
}
$('listCsv').addEventListener('click', function () {
  var text = listCSV(), b = $('listCsv');
  try {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'lunar-sites_' + iso(S.tMs).slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    b.textContent = 'Saved'; setTimeout(function () { b.textContent = 'Export CSV'; }, 2200);
  } catch (x) {}
});
