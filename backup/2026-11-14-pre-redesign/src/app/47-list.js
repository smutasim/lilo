/* ================= site list: every site of the operator in one table ================= */
/* One row per site, the same quantities as the Site view, for the statistics period that starts at the dial
   time. Grouped by kind until a column header is clicked; then sorted by that column. No column is a score. */
var LIST = { sort: null, dir: 1, rows: [] };
var LCOLS = [
  { k: 'irrNow', name: 'Irradiance now', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'irradiance_now_w_m2' },
  { k: 'irr', name: 'Mean', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'mean_irradiance_w_m2' },
  { k: 'day', name: 'Lowest 24 h', unit: 'W/m²', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, csv: 'lowest_24h_mean_irradiance_w_m2' },
  { k: 'lit', name: 'Sun in view', unit: '', fmt: pct, csv: 'sun_in_view_fraction' },
  { k: 'dark', name: 'Longest dark', unit: '', fmt: fmtHours, csv: 'longest_darkness_h' },
  { k: 'earth', name: 'Earth link', unit: '', fmt: pct, csv: 'earth_link_fraction' },
  { k: 'out', name: 'Longest outage', unit: '', fmt: fmtHours, csv: 'longest_link_outage_h' },
  { k: 'slope', name: 'Slope', unit: '', fmt: function (v) { return isFinite(v) ? v.toFixed(1) + '°' : 'n/a'; }, csv: 'slope_deg' },
  { k: 'next', name: 'All limits met', unit: '', fmt: null, csv: 'limits_next_met_utc' }
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
function terrShort(s) { return !s.terr ? 'none' : s.terr.dem[0] + ' LOLA' + (s.clones || (!s.custom && s.id && CLONES.sites[s.id]) ? ' + clones' : ''); }
/* Six columns by default; the rest are one click away in the Columns menu. The CSV always has every column. */
var COL_HIDE = { terr: 1, irrNow: 1, out: 1, slope: 1 };
try { var ch = JSON.parse(localStorage.getItem('lwb.cols') || 'null'); if (ch && typeof ch === 'object') COL_HIDE = ch; } catch (x) {}
function colMenu() {
  var all = [{ k: 'terr', name: 'Terrain' }].concat(LCOLS);
  $('colList').innerHTML = all.map(function (c) { return '<label class="check"><input type="checkbox" data-col="' + c.k + '"' + (COL_HIDE[c.k] ? '' : ' checked') + '><span>' + c.name + (c.unit ? ' (' + c.unit + ')' : '') + '</span></label>'; }).join('');
}
$('colList').addEventListener('change', function (e) {
  var k = e.target.getAttribute('data-col'); if (!k) return;
  if (e.target.checked) delete COL_HIDE[k]; else COL_HIDE[k] = 1;
  try { localStorage.setItem('lwb.cols', JSON.stringify(COL_HIDE)); } catch (x) {}
  updateList();
});
document.addEventListener('click', function (e) { var m = $('colMenu'); if (m.open && !m.contains(e.target)) m.open = false; });
colMenu();
function updateList() {
  if (S.view !== 'list') return;
  LCOLS[5].name = linkWord();
  var i0 = stepOf(S.tMs), rows = SITES.map(function (s, idx) { return listRow(s, idx, i0); }), k = LIST.sort;
  var cols = LCOLS.filter(function (c) { return !COL_HIDE[c.k]; }), terr = !COL_HIDE.terr, ncol = cols.length + (terr ? 1 : 0) + 2;
  LIST.rows = rows;
  $('listWhen').textContent = 'Next ' + S.horizonD + ' days from ' + fmtFull(S.tMs);
  var h = '<tr><th>Site</th>' + (terr ? '<th style="text-align:left">Terrain</th>' : '') + cols.map(function (c) { return '<th data-k="' + c.k + '"' + (k === c.k ? ' aria-sort="' + (LIST.dir > 0 ? 'ascending' : 'descending') + '"' : '') + ' title="Sort by this column">' + c.name + (c.unit ? '<br><span class="mu">' + c.unit + '</span>' : '') + (k === c.k ? (LIST.dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '<th><span class="sr">Actions</span></th></tr>';
  function line(r) {
    var s = r.s, t = '<tr data-i="' + r.idx + '"' + (r.idx === S.sel ? ' class="sel"' : '') + ' title="Open ' + esc(s.name) + '"><td><span class="dot' + (r.ok && r.now ? ' on' : '') + '" title="' + (r.ok && r.now ? 'Your limits are met now' : 'Your limits are not met now') + '"></span>' + esc(s.name) + '<br><span class="mu">' + fmtCoord(s.lat, s.lon) + '</span></td>' + (terr ? '<td style="text-align:left" class="mu">' + terrShort(s) + '</td>' : '');
    if (!r.ok) t += '<td colspan="' + cols.length + '" style="text-align:left" class="mu">' + (s.ready ? 'No terrain model near the pole: numbers would be wrong, so none are shown.' : 'Computing…') + '</td>';
    else cols.forEach(function (c) { t += '<td>' + (c.k === 'next' ? r.nextTxt : c.fmt(r[c.k])) + '</td>'; });
    return t + '<td class="act"><button type="button" data-act="pin">Pin</button>' + (s.custom ? ' <button type="button" data-act="del" aria-label="Remove ' + esc(s.name) + '">×</button>' : '') + '</td></tr>';
  }
  if (k) {
    rows.slice().sort(function (a, b) { var x = a.ok && isFinite(a[k]) ? a[k] : null, y = b.ok && isFinite(b[k]) ? b[k] : null; if (x === null || y === null) return (x === null) - (y === null); return (x - y) * LIST.dir; }).forEach(function (r) { h += line(r); });
  } else CATS.forEach(function (cat) {
    var g = rows.filter(function (r) { return r.s.cat === cat[0]; }); if (!g.length) return;
    h += '<tr class="grp"><td colspan="' + ncol + '">' + cat[1] + '</td></tr>'; g.forEach(function (r) { h += line(r); });
  });
  $('listTable').innerHTML = h;
  $('listNote').innerHTML = 'Irradiance is on a Sun-facing surface (W/m²): 1361 at 1 au, scaled by the Sun\'s distance and the visible fraction of its disk. <b>Mean</b> and <b>Lowest 24 h</b> are over the statistics period; the lowest 24 h mean is the worst day a power system has to bridge. <b>' + linkWord() + '</b>: ' + esc(linkRuleText()) + ' The green dot and the last column use all your limits. Slope is the LOLA grid value, not a lander-scale slope. More columns are under <b>Columns</b>; the exported table always has all of them. Change the dates with <b>Period</b> and the limits with <b>Limits</b>; move the time on the Site view.';
}
$('listTable').addEventListener('click', function (e) {
  var th = e.target.closest('th[data-k]');
  if (th) {
    var k = th.getAttribute('data-k'), lowFirst = k === 'dark' || k === 'out' || k === 'slope' || k === 'next';
    if (LIST.sort !== k) { LIST.sort = k; LIST.dir = lowFirst ? 1 : -1; } else if (LIST.dir === (lowFirst ? 1 : -1)) LIST.dir = -LIST.dir; else LIST.sort = null;
    updateList(); return;
  }
  var tr = e.target.closest('tr[data-i]'); if (!tr) return;
  var idx = +tr.getAttribute('data-i'), b = e.target.closest('button'), act = b ? b.getAttribute('data-act') : 'open';
  if (act === 'open') { selectSite(idx); setView('site'); }
  else if (act === 'pin') { var s = SITES[idx]; if (!S.pins.some(function (p) { return p.site === s && Math.abs(p.tMs - S.tMs) < 60000; })) { if (S.pins.length >= 4) S.pins.shift(); S.pins.push({ site: s, tMs: S.tMs }); } setTab('compare'); writeHash(); $('anH').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  else if (act === 'del') removeSiteAt(idx);
});
function listCSV() {
  var L = ['# Lunar Window Browser, site list. Not flight-grade.', '# period: ' + S.horizonD + ' days from ' + iso(S.tMs), '# limits: ' + limitsList().join('; '), '# irradiance: W/m2 on a Sun-facing surface; 1361 W/m2 at 1 au (IAU 2015 Resolution B3) x (1 au / Sun distance)^2 x visible fraction of the solar disk',
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
    b.textContent = 'Saved'; setTimeout(function () { b.textContent = 'Export table'; }, 2200);
  } catch (x) {}
});
