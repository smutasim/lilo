/* ================= find a site ================= */
/* Step 1-3: every point of the built-in survey (data/survey.json: one real LOLA horizon mask per 5.04 km cell
   south of 85 S) is evaluated for the operator's own landing date and surface stay, then filtered by the
   operator's goals. Nothing is ranked or rated: a point either meets the stated goals or it does not, and the
   funnel shows which goal removes how many. Step 4 looks at the ground around one candidate on a fine grid and
   answers "how precisely do we have to land": see landingProb in core.js. */
var FIND = { ready: false, loading: false, fail: false, geos: null, xy: null, masks: null, met: null, key: null, token: 0, M: null, sel: -1, pass: null, inArea: null, order: [], view: null, geom: null, fallback: false };
var GOALS = [
  { id: 'gIrr', k: 'irr', name: 'Mean irradiance', max: true, fmt: wm2, scale: 1 },
  { id: 'gDay', k: 'day', name: 'Lowest 24 h mean irradiance', max: true, fmt: wm2, scale: 1 },
  { id: 'gDark', k: 'dark', name: 'Longest darkness', max: false, fmt: fmtHours, scale: 1 },
  { id: 'gEarth', k: 'earth', name: 'Earth link', max: true, fmt: pct, scale: 0.01 },
  { id: 'gOut', k: 'out', name: 'Longest Earth-link outage', max: false, fmt: fmtHours, scale: 1 },
  { id: 'gSlope', k: 'slope', name: 'Slope', max: false, fmt: function (v) { return v.toFixed(1) + '°'; }, scale: 1 }
];
var GOAL_BY = {}; GOALS.forEach(function (g) { GOAL_BY[g.k] = g; });
function goalVal(k, m, slope) { return k === 'irr' ? m.irrAvg : k === 'day' ? m.irrDayMin : k === 'dark' ? m.darkMaxH : k === 'earth' ? m.earthFrac : k === 'out' ? m.outMaxH : slope; }
function readGoals() {
  var out = [];
  GOALS.forEach(function (g) { var v = parseFloat($(g.id).value); if (isFinite(v)) out.push({ g: g, lim: v * g.scale }); });
  return out;
}
function meetsOne(q, m, slope) { var v = goalVal(q.g.k, m, slope); return q.g.max ? v >= q.lim - 1e-9 : v <= q.lim + 1e-9; }
function meetsAll(goals, m, slope) { for (var i = 0; i < goals.length; i++) if (!meetsOne(goals[i], m, slope)) return false; return true; }
function goalText(q) { return q.g.name + (q.g.max ? ' ≥ ' : ' ≤ ') + q.g.fmt(q.lim); }
function surveySlope(p) { return p[4] !== null && p[4] !== undefined ? p[4] : p[3]; }
function surveyLoad() {
  if (FIND.ready || FIND.fail) return Promise.resolve();
  if (FIND.loading) return FIND.loading;
  FIND.loading = gunzipB64(SURVEY.gz).then(function (bytes) {
    FIND.loading = false;
    if (!bytes) { FIND.fail = true; return; }
    var P = SURVEY.pts, hobs = SURVEY.meta.hobs_m;
    FIND.masks = LWB.decodeMasks(bytes, P.length, SURVEY.meta.nb);
    FIND.geos = P.map(function (p, k) { return LWB.makeSite(p[0], p[1], p[2] + hobs, FIND.masks[k], hobs); });
    FIND.xy = P.map(function (p) { return polarXY(p[0], p[1]); });
    FIND.ready = true;
  });
  return FIND.loading;
}
/* The mission period. Sampled hourly up to 45 days, every 2 h beyond that. */
function findMission() {
  var v = $('fStart').value, t0 = S.startMs, days = clamp(parseFloat($('fDays').value) || 30, 1, 180);
  if (v) { var p = v.split('-'); t0 = Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  return { t0: t0, days: days, stepMin: days <= 45 ? 60 : 120, key: [t0, days, S.linkMin, commsKey()].join(':') };
}
function findCompute() {
  if (S.view !== 'find') return;
  if (!FIND.ready) {
    $('fStatus').textContent = FIND.fail ? 'This browser cannot unpack the built-in survey (it needs DecompressionStream). The Site and Compare views still work.' : 'Unpacking the survey…';
    if (!FIND.fail) surveyLoad().then(function () { if (FIND.ready || FIND.fail) findCompute(); });
    return;
  }
  var M = findMission();
  if (FIND.key === M.key) { findApply(); lpRefresh(); return; }
  var token = ++FIND.token, ser = LWB.series(M.t0, M.days, M.stepMin), cm = commsFor(ser), gate = cm && cm.gate, relay = cm && cm.relay, n = FIND.geos.length, met = new Array(n), i = 0;
  FIND.fallback = ser.src !== 'spice';
  $('fProgWrap').style.visibility = 'visible'; $('fStatus').textContent = 'Evaluating ' + n.toLocaleString('en-US') + ' horizons for your dates…';
  (function next() {
    if (token !== FIND.token) return;
    var t0 = performance.now();
    while (i < n && performance.now() - t0 < 30) { met[i] = LWB.metricsFrom(FIND.geos[i], ser, S.linkMin, gate, relay); i++; }
    $('fProg').style.width = (i / n * 100).toFixed(1) + '%';
    if (i < n) { setTimeout(next, 0); return; }
    FIND.met = met; FIND.key = M.key; FIND.M = M; $('fProgWrap').style.visibility = 'hidden'; $('fProg').style.width = '0';
    window.LWB_FIND_MS = Math.round(performance.now() - BOOT_T0);
    findApply(); lpRefresh();
  })();
}
function readArea() {
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : null; }
  var a = { la0: num('fLat0'), la1: num('fLat1'), lo0: num('fLon0'), lo1: num('fLon1') };
  a.active = a.la0 !== null || a.la1 !== null || (a.lo0 !== null && a.lo1 !== null);
  return a;
}
function inArea(a, lat, lon) {
  var s = -lat, lo = a.la0 !== null && a.la1 !== null ? Math.min(a.la0, a.la1) : a.la0, hi = a.la0 !== null && a.la1 !== null ? Math.max(a.la0, a.la1) : a.la1;
  if (lo !== null && s < lo - 1e-9) return false;
  if (hi !== null && s > hi + 1e-9) return false;
  if (a.lo0 !== null && a.lo1 !== null) { var w = ((a.lo1 - a.lo0) % 360 + 360) % 360 || 360; if (((lon - a.lo0) % 360 + 360) % 360 > w) return false; }
  return true;
}
function findApply() {
  if (!FIND.met) return;
  var P = SURVEY.pts, n = P.length, goals = readGoals(), area = readArea(), pass = new Uint8Array(n), inA = new Uint8Array(n), k, left = [], order = [];
  for (k = 0; k < n; k++) if (inArea(area, P[k][0], P[k][1])) { inA[k] = 1; left.push(k); }
  var html = '<li><b>Survey points' + (area.active ? ' in your area' : ', 85°S to the pole') + '</b><span>' + left.length.toLocaleString('en-US') + '</span></li>', n0 = Math.max(1, left.length);
  goals.forEach(function (q) {
    left = left.filter(function (j) { return meetsOne(q, FIND.met[j], surveySlope(P[j])); });
    html += '<li><b>' + esc(goalText(q)) + '</b><span>' + left.length.toLocaleString('en-US') + ' left</span><div class="bar2"><i style="width:' + (left.length / n0 * 100).toFixed(1) + '%"></i></div></li>';
  });
  html += '<li class="end"><b>' + (goals.length ? 'Meet every goal' : 'No goals set: all shown') + '</b><span>' + left.length.toLocaleString('en-US') + '</span></li>';
  $('funnel').innerHTML = html;
  left.forEach(function (j) { pass[j] = 1; });
  var ck = $('fColor').value, cg = GOAL_BY[ck];
  function cv(j) { return ck === 'ref' ? P[j][5] : goalVal(ck, FIND.met[j], surveySlope(P[j])); }
  order = left.slice().sort(function (a, b) { return (cg && !cg.max ? 1 : -1) * (cv(a) - cv(b)); });
  var lo = Infinity, hi = -Infinity; order.forEach(function (j) { var v = cv(j); if (v < lo) lo = v; if (v > hi) hi = v; });
  FIND.pass = pass; FIND.inArea = inA; FIND.order = order; FIND.cv = cv; FIND.crng = [lo, hi]; FIND.cmax = !(cg && !cg.max); FIND.goals = goals; FIND.area = area;
  // the map shrinks to the points that are left
  var H0 = POLAR.half_m, view = { cx: 0, cy: 0, half: H0 };
  if ((goals.length || area.active) && order.length) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    order.forEach(function (j) { var p = FIND.xy[j]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
    view.half = clamp(Math.max(x1 - x0, y1 - y0) / 2 * 1.25 + 4000, 15000, H0);
    view.cx = clamp((x0 + x1) / 2, -H0 + view.half, H0 - view.half); view.cy = clamp((y0 + y1) / 2, -H0 + view.half, H0 - view.half);
  }
  FIND.view = view;
  drawFmap(); findTable(); findNote();
}
function findNote() {
  var M = FIND.M, m = SURVEY.meta;
  $('fStatus').textContent = '';
  $('fSurveyNote').textContent = 'Period: ' + iso(M.t0).slice(0, 10) + ' to ' + iso(M.t0 + M.days * DAY).slice(0, 10) + ' UTC.';
  $('fNote').innerHTML = '<b>What the candidates are.</b> ' + SURVEY.pts.length.toLocaleString('en-US') + ' points, one per ' + m.cell_km + ' km cell from 85°S to the pole, each placed on the cell\'s brightest pixel in the PGDA 18.6-year average-visibility map. That map only chooses where the point sits. Every number here is computed for your dates from the point\'s own LOLA horizon mask (' + m.hobs_m + ' m observer, ' + m.nb + ' azimuth bins), sampled every ' + M.stepMin + ' min' + (FIND.fallback ? ', <b>with the fallback ephemeris for part of the period</b>' : '') + '. ' +
    'Irradiance is on a Sun-facing surface: 1361 W/m² at 1 au, scaled by the Sun\'s distance and the visible fraction of its disk. Slope is from the 5 m model over a 10 m baseline where a 5 m tile exists, otherwise from the 20 m mosaic over 40 m. ' + esc(linkRuleText()) + ' ' +
    '<b>What this cannot tell you.</b> A 5 km cell holds better and worse ground than its one point, so an empty map means no <i>survey point</i> meets the goals, not that no ground does. Elevation-model error is not quantified for survey points. Choose a candidate to study the ground around it in step 4.';
}
function fmtLat(lat) { return Math.abs(lat).toFixed(3) + '°' + (lat < 0 ? 'S' : 'N'); }
function findTable() {
  var P = SURVEY.pts, rows = FIND.order.slice(0, 60), M = FIND.M, ck = $('fColor').value;
  var cols = [['irr', 'Mean W/m²'], ['day', 'Lowest 24 h'], ['dark', 'Longest dark'], ['earth', 'Earth link'], ['out', 'Longest outage'], ['slope', 'Slope']];
  var h = '<tr><th>Candidate (' + FIND.order.length.toLocaleString('en-US') + (FIND.order.length > rows.length ? ', first ' + rows.length : '') + ')</th>' + cols.map(function (c) { return '<th' + (c[0] === ck ? ' aria-sort="' + (GOAL_BY[ck].max ? 'descending' : 'ascending') + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '<th' + (ck === 'ref' ? ' aria-sort="descending"' : '') + '>18.6-yr avg</th></tr>';
  if (!rows.length) h += '<tr><td colspan="8" style="text-align:left;color:var(--mute)">No survey point meets every goal' + (FIND.area.active ? ' in this area' : '') + '. The funnel on the left shows which goal removes the most; relax that one first.</td></tr>';
  rows.forEach(function (j) {
    var p = P[j], m = FIND.met[j], sl = surveySlope(p);
    h += '<tr data-k="' + j + '"' + (j === FIND.sel ? ' class="sel"' : '') + ' style="cursor:pointer"><td>' + fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E</td><td>' + Math.round(m.irrAvg) + '</td><td>' + Math.round(m.irrDayMin) + '</td><td>' + fmtHours(m.darkMaxH) + '</td><td>' + pct(m.earthFrac) + '</td><td>' + fmtHours(m.outMaxH) + '</td><td>' + sl.toFixed(1) + '°</td><td class="mu">' + Math.round(p[5]) + '%</td></tr>';
  });
  $('fTable').innerHTML = h;
}
$('fTable').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-k]'); if (tr) selectCandidate(+tr.getAttribute('data-k')); });
function drawFmap() {
  if (S.view !== 'find') return;
  var cv = $('fmap'), w0 = Math.min(cv.clientWidth || 400, 640); cv.style.height = w0 + 'px'; cv.style.maxWidth = '640px';
  var F = fit(cv, w0), c = F.c, w = F.w, V = FIND.view || { cx: 0, cy: 0, half: POLAR.half_m }, H0 = POLAR.half_m, sc = w / (2 * V.half);
  var base = baseLayer();
  function X(x) { return (x - V.cx + V.half) * sc; } function Y(y) { return (V.cy + V.half - y) * sc; }
  c.fillStyle = '#0B0F15'; c.fillRect(0, 0, w, w);
  var n = base.n, k = n / (2 * H0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(base.src, (V.cx - V.half + H0) * k, (H0 - V.cy - V.half) * k, 2 * V.half * k, 2 * V.half * k, 0, 0, w, w);
  c.fillStyle = 'rgba(8,11,16,.35)'; c.fillRect(0, 0, w, w);
  c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 1; c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'left'; c.textBaseline = 'bottom';
  [-89, -88, -87, -86].forEach(function (la) { var r = PR * Math.tan((90 + la) / 2 * D2R) * sc; c.beginPath(); c.arc(X(0), Y(0), r, 0, 6.2832); c.stroke(); var ly = Y(0) - r; if (ly > 12 && ly < w && X(0) > 0 && X(0) < w - 30) c.fillText(Math.abs(la) + '°S', X(0) + 3, ly - 2); });
  c.beginPath(); c.moveTo(X(0), 0); c.lineTo(X(0), w); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke();
  var pts = [];
  if (FIND.met) {
    var rad = clamp(5040 * sc * 0.42, 2.2, 9), r = FIND.crng, P = SURVEY.pts, j;
    c.fillStyle = 'rgba(255,255,255,0.22)';
    for (j = 0; j < P.length; j++) { if (!FIND.inArea[j] || FIND.pass[j]) continue; var q = FIND.xy[j], x = X(q[0]), y = Y(q[1]); if (x < -4 || y < -4 || x > w + 4 || y > w + 4) continue; c.fillRect(x - 1, y - 1, 2, 2); pts.push({ k: j, x: x, y: y }); }
    for (var o = FIND.order.length - 1; o >= 0; o--) {
      j = FIND.order[o]; var q2 = FIND.xy[j], x2 = X(q2[0]), y2 = Y(q2[1]);
      var u = r[1] > r[0] ? (FIND.cv(j) - r[0]) / (r[1] - r[0]) : 1; if (!FIND.cmax) u = 1 - u;
      c.fillStyle = ramp(u); c.beginPath(); c.arc(x2, y2, rad, 0, 6.2832); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke();
      pts.push({ k: j, x: x2, y: y2 });
    }
  }
  // listed sites for orientation
  c.textBaseline = 'middle';
  SITES.forEach(function (s) {
    if (s.lat > -84.9) return;
    var p = polarXY(s.lat, s.lon), x = X(p[0]), y = Y(p[1]); if (x < 0 || y < 0 || x > w || y > w) return;
    c.strokeStyle = '#fff'; c.lineWidth = 1.4; c.strokeRect(x - 3.5, y - 3.5, 7, 7);
    if (V.half < 70000) { var t = s.name.split(',')[0].replace('Shackleton-de Gerlache ', ''); c.lineWidth = 3; c.strokeStyle = 'rgba(8,10,14,.85)'; c.strokeText(t, x + 7, y); c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(t, x + 7, y); }
  });
  if (FIND.sel >= 0) { var qs = FIND.xy[FIND.sel]; c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(X(qs[0]), Y(qs[1]), 12, 0, 6.2832); c.stroke(); }
  // scale bar and colour key
  var barKm = [1, 2, 5, 10, 20, 50, 100].filter(function (b) { return b * 1000 * sc <= w * 0.3; }).pop() || 1;
  c.fillStyle = 'rgba(8,10,14,.7)'; c.fillRect(0, w - 24, w, 24);
  c.fillStyle = '#fff'; c.fillRect(10, w - 10, barKm * 1000 * sc, 2); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(barKm + ' km', 10, w - 12);
  if (FIND.met && FIND.order.length) {
    var ck = $('fColor').value, g = GOAL_BY[ck], f = g ? g.fmt : function (v) { return Math.round(v) + '%'; }, gx = w - 150;
    for (var q3 = 0; q3 < 60; q3++) { c.fillStyle = ramp(q3 / 59); c.fillRect(gx + q3, w - 11, 1.5, 6); }
    c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(f(FIND.cmax ? FIND.crng[0] : FIND.crng[1]), gx - 5, w - 4); c.textAlign = 'left'; c.fillText(f(FIND.cmax ? FIND.crng[1] : FIND.crng[0]), gx + 64, w - 4);
  }
  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(255,255,255,.6)';
  if (V.half >= H0 * 0.98) c.fillText('0° (Earth side)', w / 2, 4);
  FIND.geom = { pts: pts };
}
function candText(j) {
  var p = SURVEY.pts[j], m = FIND.met[j];
  return fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E, height ' + Math.round(p[2]) + ' m: mean ' + wm2(m.irrAvg) + ', lowest 24 h mean ' + wm2(m.irrDayMin) + ', longest dark ' + fmtHours(m.darkMaxH) + ', Earth link ' + pct(m.earthFrac) + ', longest outage ' + fmtHours(m.outMaxH) + ', slope ' + surveySlope(p).toFixed(1) + '°' + (FIND.pass[j] ? '' : ' · does not meet every goal');
}
function fmapNearest(e, cv) {
  if (!FIND.geom) return -1;
  var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = 14;
  FIND.geom.pts.forEach(function (p) { var d = Math.hypot(p.x - x, p.y - y) - (FIND.pass[p.k] ? 3 : 0); if (d < bd) { bd = d; best = p.k; } });
  return best;
}
$('fmap').addEventListener('pointermove', function (e) { var j = fmapNearest(e, this); $('fRead').textContent = j >= 0 ? candText(j) + ' · click to choose' : (FIND.sel >= 0 ? 'Chosen: ' + candText(FIND.sel) : 'Bright dots meet every goal; faint dots are survey points that do not. Squares are the listed sites.'); });
$('fmap').addEventListener('click', function (e) { var j = fmapNearest(e, this); if (j >= 0) selectCandidate(j); });
function selectCandidate(j) {
  FIND.sel = j;
  var p = SURVEY.pts[j];
  $('fRead').textContent = 'Chosen: ' + candText(j);
  drawFmap(); findTable();
  lpSet({ name: 'Survey point ' + fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E', lat: p[0], lon: ((p[1] + 540) % 360) - 180, survey: j, site: null });
}
['fStart', 'fDays'].forEach(function (id) { $(id).addEventListener('change', findCompute); });
['fLat0', 'fLat1', 'fLon0', 'fLon1', 'fColor'].concat(GOALS.map(function (g) { return g.id; })).forEach(function (id) { $(id).addEventListener('change', function () { findApply(); if (id !== 'fColor') lpApply(); writeHash(); }); });

/* ================= landing precision ================= */
/* Fine grids of real horizon masks around a point. Three sources, best first: a 50 m grid file shipped beside
   the page (dist/regions/<id>.js), the 100 m grid inside the page, or a grid computed on demand by the terrain
   helper for any point south of 80 S. */
var LP = { cand: null, G: null, met: null, key: null, token: 0, res: null, geom: null, grids: {} };
var REGION_WAIT = {};
window.LWB_REGION = function (rec) { var w = rec && REGION_WAIT[rec.id]; if (w) w(rec); };
function inlineGrid(s) {
  return loadGrid(s).then(function (G) { return G ? { n: G.n, d: G.d, hobs: G.hobs, masks: G.masks, h: G.h, slope: G.slope, slopeGrid: s.terr.grid.slope_grid, src: 'the 100 m grid built into the page' } : null; });
}
function loadRegion(s) {
  if (s.region) return Promise.resolve(s.region);
  if (!s.terr || !s.terr.grid) return Promise.resolve(null);
  if (s.custom || !s.id || REGION_IDS.indexOf(s.id) < 0) return inlineGrid(s);
  return new Promise(function (res) {
    var done = false, sc = document.createElement('script');
    function fallback() { if (done) return; done = true; inlineGrid(s).then(res); }
    REGION_WAIT[s.id] = function (rec) {
      if (done) return; done = true;
      gunzipB64(rec.gz).then(function (bytes) {
        if (!bytes) { inlineGrid(s).then(res); return; }
        s.region = { n: rec.n, d: rec.spacing_m, hobs: rec.hobs_m, masks: LWB.decodeMasks(bytes, rec.n * rec.n, rec.nb), h: rec.h, slope: rec.slope, slopeGrid: rec.slope_grid, src: 'the ' + rec.spacing_m + ' m grid file shipped with the page' };
        res(s.region);
      });
    };
    sc.src = 'regions/' + s.id + '.js'; sc.onerror = fallback; document.head.appendChild(sc);
    setTimeout(fallback, 6000);
  });
}
function lpSet(cand) {
  LP.cand = cand; LP.G = null; LP.met = null; LP.key = null; LP.res = null; LP.token++;
  $('lpCard').hidden = false; $('lpTitle').textContent = 'Landing precision at ' + cand.name;
  $('lpOut').textContent = ''; $('lpRead').textContent = ''; $('lpHelperRow').hidden = true; $('lpProgWrap').hidden = true;
  var token = LP.token, cached = LP.grids[cand.lat.toFixed(5) + ',' + cand.lon.toFixed(5)];
  if (cached) { LP.G = cached; lpCompute(); return; }
  if (cand.site && cand.site.terr && cand.site.terr.grid) {
    $('lpOut').textContent = 'Loading the terrain grid…'; drawLp();
    loadRegion(cand.site).then(function (G) { if (token !== LP.token) return; if (!G) { lpNoGrid(); return; } LP.G = G; lpCompute(); });
    return;
  }
  lpNoGrid();
}
function lpNoGrid() {
  var token = LP.token; drawLp();
  if (LP.cand.lat > -80.02) { $('lpOut').textContent = 'No terrain grid is available north of 80°S, so landing precision cannot be assessed here.'; $('lpNote').textContent = ''; return; }
  $('lpOut').textContent = 'Looking for the terrain helper…';
  pingHelper().then(function (ok) {
    if (token !== LP.token) return;
    $('lpHelperRow').hidden = !ok;
    $('lpOut').innerHTML = ok ? 'No grid ships for this point. The terrain helper is running: it can compute a 1 km square of horizon masks at 50 m spacing around it (441 masks, about a minute).'
      : 'Landing precision needs a fine grid of horizon masks around the point. Grids ship for the listed south-pole sites (open one and press <b>Landing precision here</b>). For any other point south of 80°S, start the terrain helper (<code>python tools/terrain/serve.py</code>) and choose the candidate again.';
    $('lpNote').textContent = '';
  });
}
$('lpCompute').addEventListener('click', function () {
  var cand = LP.cand, token = LP.token, n = 21, d = 50, row = 0, masks = [], h = [], slope = [], sg = '', nb = 720;
  $('lpHelperRow').hidden = true; $('lpProgWrap').hidden = false; $('lpProg').style.width = '0'; $('lpOut').textContent = 'Computing horizon masks on your machine…';
  (function next() {
    fetch(helperBase() + '/grid?lat=' + cand.lat + '&lon=' + cand.lon + '&n=' + n + '&d=' + d + '&row=' + row).then(function (r) { return r.json(); }).then(function (j) {
      if (token !== LP.token) return;
      if (!j || j.error) { $('lpOut').textContent = 'The helper could not compute this grid: ' + (j && j.error || 'no answer') + '.'; $('lpProgWrap').hidden = true; return; }
      var all = LWB.b64i16(j.masks); nb = j.nb; sg = j.slope_grid;
      for (var i = 0; i < n; i++) masks.push(all.slice(i * nb, (i + 1) * nb));
      h = h.concat(j.h); slope = slope.concat(j.slope);
      row++; $('lpProg').style.width = (row / n * 100).toFixed(0) + '%';
      if (row < n) { next(); return; }
      $('lpProgWrap').hidden = true;
      LP.G = { n: n, d: d, hobs: j.hobs_m, masks: masks, h: h, slope: slope, slopeGrid: sg, src: 'a grid computed just now by the terrain helper' };
      LP.grids[cand.lat.toFixed(5) + ',' + cand.lon.toFixed(5)] = LP.G;
      lpCompute();
    }, function () { if (token === LP.token) { $('lpOut').textContent = 'The terrain helper stopped answering.'; $('lpProgWrap').hidden = true; } });
  })();
});
function lpRefresh() { if (LP.cand && LP.G) lpCompute(); }
function lpCompute() {
  var G = LP.G, cand = LP.cand, M = findMission(), key = M.key + ':' + cand.lat + ':' + cand.lon + ':' + G.n + ':' + G.d;
  if (LP.key === key && LP.met) { lpApply(); return; }
  var token = ++LP.token, ser = LWB.series(M.t0, M.days, M.stepMin), cm = commsFor(ser), gate = cm && cm.gate, relay = cm && cm.relay, n = G.n, N = n * n, met = new Array(N), i = 0, c = (n - 1) / 2;
  $('lpProgWrap').hidden = false; $('lpOut').textContent = 'Evaluating ' + N.toLocaleString('en-US') + ' horizons…';
  (function next() {
    if (token !== LP.token) return;
    var t0 = performance.now();
    while (i < N && performance.now() - t0 < 30) {
      var ix = i % n, iy = (i - ix) / n, ll = LWB.offsetLatLon(cand.lat, cand.lon, (ix - c) * G.d, (iy - c) * G.d);
      met[i] = LWB.metricsFrom(LWB.makeSite(ll.lat, ll.lon, G.h[i] + G.hobs, G.masks[i], G.hobs), ser, S.linkMin, gate, relay); i++;
    }
    $('lpProg').style.width = (i / N * 100).toFixed(0) + '%';
    if (i < N) { setTimeout(next, 0); return; }
    LP.met = met; LP.key = key; LP.M = M; $('lpProgWrap').hidden = true; $('lpProg').style.width = '0';
    window.LWB_LP_MS = Math.round(performance.now() - BOOT_T0);
    lpApply();
  })();
}
function probText(lo, hi) {
  function p1(v) { return v > 0.9995 ? '>99.9%' : v < 0.0005 ? '<0.1%' : (v * 100).toFixed(1) + '%'; }
  return hi - lo < 0.001 ? p1(lo) : 'between ' + p1(lo) + ' and ' + p1(hi);
}
function offText(de, dn) { var r = Math.hypot(de, dn); return r < 1 ? 'the point itself' : Math.round(r) + ' m ' + compass16((Math.atan2(de, dn) * R2D + 360) % 360) + ' of it'; }
function lpApply() {
  if (!LP.G || !LP.met) return;
  var G = LP.G, n = G.n, N = n * n, goals = readGoals(), pass = new Uint8Array(N), c = (n - 1) / 2, ci = c * n + c, np = 0, i;
  for (i = 0; i < N; i++) if (meetsAll(goals, LP.met[i], G.slope[i])) { pass[i] = 1; np++; }
  var a = parseFloat($('lpA').value), b = parseFloat($('lpB').value), haveE = a > 0 && b > 0, half = c * G.d;
  var R = { pass: pass, goals: goals, np: np, fd: LWB.failDistance(pass, n, G.d), prob: null, best: -1, a: a, b: b, haveE: haveE };
  var t = '';
  if (!goals.length) t = 'No goals are set in step 2, so every point passes. Set at least one goal to see where it stops being met. ';
  else {
    t = '<b>' + (pass[ci] ? 'The point meets every goal' : 'The point itself does not meet every goal') + '</b>; so do ' + np.toLocaleString('en-US') + ' of the ' + N.toLocaleString('en-US') + ' grid points around it (' + pct(np / N) + ' of a ' + (2 * half / 1000) + ' km square). ';
    if (pass[ci]) t += isFinite(R.fd[ci]) ? 'The nearest grid point that fails is <b>' + Math.round(R.fd[ci]) + ' m</b> away. ' : 'No grid point fails within ' + Math.round(half) + ' m. ';
    if (haveE) {
      R.prob = LWB.landingProb(pass, n, G.d, a / 3, b / 3);
      var best = 0; for (i = 1; i < N; i++) { var dl = R.prob.lo[i] - R.prob.lo[best]; if (dl > 1e-6 || (Math.abs(dl) <= 1e-6 && Math.hypot(i % n - c, Math.floor(i / n) - c) < Math.hypot(best % n - c, Math.floor(best / n) - c))) best = i; }
      R.best = best;
      t += '<br><b>Aiming at the point with a ' + a + ' × ' + b + ' m (3σ, east × north) ellipse, the chance of landing where every goal is met is ' + probText(R.prob.lo[ci], R.prob.hi[ci]) + '.</b> ';
      if (best !== ci && R.prob.lo[best] > R.prob.lo[ci] + 0.0005) t += 'The best aim point in this grid is ' + offText((best % n - c) * G.d, (Math.floor(best / n) - c) * G.d) + ': ' + probText(R.prob.lo[best], R.prob.hi[best]) + '. ';
      else t += 'No aim point in this grid does better. ';
      if (Math.min(a, b) < G.d) t += '<b>An axis of this ellipse is shorter than the ' + G.d + ' m grid spacing</b>, so the result mostly repeats single grid points. ';
      if (Math.max(a, b) > half) t += 'The ellipse reaches past the grid; ground outside it is unknown, which is why a range is given. ';
    } else t += '<br>Enter your landing ellipse to get the chance of meeting the goals for every aim point.';
  }
  $('lpOut').innerHTML = t;
  var M = LP.M;
  $('lpNote').innerHTML = '<b>How this is computed.</b> ' + n + ' × ' + n + ' points at ' + G.d + ' m (' + (2 * half / 1000) + ' km across), from ' + G.src + '. Each point has its own LOLA horizon mask (' + G.hobs + ' m observer) and is evaluated for ' + iso(M.t0).slice(0, 10) + ' + ' + M.days + ' days, every ' + M.stepMin + ' min, against the goals in step 2. Slope is the ' + G.slopeGrid + ' model value at each point. ' +
    'The landing point is taken as normally distributed about the aim point, your semi-axes being 3σ along east and north. The chance is the exact sum of that distribution over the grid cells that pass: nothing is sampled, so there is no Monte Carlo noise. Probability that falls outside the grid is counted once as a miss and once as a hit, which gives the range. ' +
    '<b>Not included:</b> a rotated or correlated ellipse, elevation-model error, and anything smaller than the grid spacing (rocks, small craters).';
  LP.res = R; drawLp();
}
function lpField(k, i) { var m = LP.met[i]; return k === 'slope' ? LP.G.slope[i] : k === 'irr' ? m.irrAvg : k === 'dark' ? m.darkMaxH : m.earthFrac; }
function drawLp() {
  if (S.view !== 'find' || $('lpCard').hidden) return;
  var cv = $('lpMap'), w0 = Math.min(cv.clientWidth || 300, 560); cv.style.height = w0 + 'px';
  var F = fit(cv, w0), c = F.c, w = F.w, G = LP.G, R = LP.res;
  c.fillStyle = '#0B0F15'; c.fillRect(0, 0, w, w); LP.geom = null;
  if (!G || !LP.met || !R) { c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText('no terrain grid loaded', w / 2, w / 2); return; }
  var n = G.n, cs = w / n, show = $('lpShow').value, i, lo = Infinity, hi = -Infinity, ctr = (n - 1) / 2;
  if (show === 'prob' && !R.prob) show = 'pass';
  var fld = show !== 'prob' && show !== 'pass', gmax = fld ? (show === 'irr' || show === 'earth') : true;
  if (fld) for (i = 0; i < n * n; i++) { var v = lpField(show, i); if (v < lo) lo = v; if (v > hi) hi = v; }
  for (i = 0; i < n * n; i++) {
    var ix = i % n, iy = (i - ix) / n, x = ix * cs, y = (n - 1 - iy) * cs;
    if (show === 'pass') c.fillStyle = R.pass[i] ? '#2E9E6B' : '#7A2F28';
    else if (show === 'prob') c.fillStyle = ramp(R.prob.lo[i]);
    else { var u = hi > lo ? (lpField(show, i) - lo) / (hi - lo) : 1; c.fillStyle = ramp(gmax ? u : 1 - u); }
    c.fillRect(x, y, cs + 0.6, cs + 0.6);
  }
  if (show !== 'pass' && R.goals.length) { // outline of the passing region
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.2; c.beginPath();
    for (i = 0; i < n * n; i++) {
      var jx = i % n, jy = (i - jx) / n, px = jx * cs, py = (n - 1 - jy) * cs;
      if (jx < n - 1 && R.pass[i] !== R.pass[i + 1]) { c.moveTo(px + cs, py); c.lineTo(px + cs, py + cs); }
      if (jy < n - 1 && R.pass[i] !== R.pass[i + n]) { c.moveTo(px, py); c.lineTo(px + cs, py); }
    }
    c.stroke();
  }
  function XY(k) { return [(k % n + 0.5) * cs, (n - 1 - Math.floor(k / n) + 0.5) * cs]; }
  function ell(k, col, dash) { var p = XY(k); c.strokeStyle = col; c.lineWidth = 2; c.setLineDash(dash || []); c.beginPath(); c.ellipse(p[0], p[1], Math.max(2, R.a / G.d * cs), Math.max(2, R.b / G.d * cs), 0, 0, 6.2832); c.stroke(); c.setLineDash([]); }
  var ci = ctr * n + ctr, pc = XY(ci);
  if (R.haveE) { ell(ci, '#fff'); if (R.best >= 0 && R.best !== ci && R.prob.lo[R.best] > R.prob.lo[ci] + 0.0005) { ell(R.best, '#47C98D', [5, 4]); var pb = XY(R.best); c.fillStyle = '#47C98D'; c.beginPath(); c.arc(pb[0], pb[1], 3, 0, 6.2832); c.fill(); } }
  c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(pc[0] - 7, pc[1]); c.lineTo(pc[0] + 7, pc[1]); c.moveTo(pc[0], pc[1] - 7); c.lineTo(pc[0], pc[1] + 7); c.stroke();
  c.fillStyle = 'rgba(8,10,14,.72)'; c.fillRect(0, 0, w, 18); c.fillRect(0, w - 18, w, 18);
  c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.9)'; c.textAlign = 'left'; c.textBaseline = 'middle';
  var names = { prob: 'chance of meeting the goals, by aim point: dark 0%, yellow 100%', pass: 'green meets every goal, red does not', irr: 'mean irradiance', dark: 'longest darkness', earth: 'Earth link', slope: 'slope' }, ff = { irr: wm2, dark: fmtHours, earth: pct, slope: function (q) { return q.toFixed(1) + '°'; } };
  c.fillText('N ↑  ' + names[show] + (fld ? ', ' + ff[show](lo) + ' to ' + ff[show](hi) + ', yellow is better' : ''), 6, 9);
  c.fillText((n - 1) * G.d / 1000 + ' km · ' + G.d + ' m points · + the point' + (R.haveE ? ' · white 3σ ellipse' + (R.best >= 0 && R.best !== ci ? ' · green best aim' : '') : ''), 6, w - 9);
  LP.geom = { n: n, cs: cs };
}
$('lpMap').addEventListener('pointermove', function (e) {
  var g = LP.geom, G = LP.G, R = LP.res; if (!g || !R) return;
  var r = this.getBoundingClientRect(), ix = clamp(Math.floor((e.clientX - r.left) / r.width * g.n), 0, g.n - 1), iy = clamp(g.n - 1 - Math.floor((e.clientY - r.top) / r.height * g.n), 0, g.n - 1), i = iy * g.n + ix, m = LP.met[i], c = (g.n - 1) / 2;
  $('lpRead').textContent = offText((ix - c) * G.d, (iy - c) * G.d).replace('of it', 'of the point').replace('the point itself', 'The point') + ': ' + (R.goals.length ? (R.pass[i] ? 'meets every goal' : 'fails ' + R.goals.filter(function (q) { return !meetsOne(q, m, G.slope[i]); }).map(function (q) { return q.g.name.toLowerCase(); }).join(', ')) + ' · ' : '') +
    'mean ' + wm2(m.irrAvg) + ', lowest 24 h ' + wm2(m.irrDayMin) + ', dark ' + fmtHours(m.darkMaxH) + ', Earth ' + pct(m.earthFrac) + ', slope ' + G.slope[i].toFixed(1) + '°' + (R.prob ? ' · aiming here: ' + probText(R.prob.lo[i], R.prob.hi[i]) : '');
});
['lpA', 'lpB'].forEach(function (id) { $(id).addEventListener('change', function () { lpApply(); writeHash(); }); });
$('lpShow').addEventListener('change', drawLp);
/* Open the candidate in the sky view. A survey point becomes one of the operator's sites, with its own mask. */
$('lpOpen').addEventListener('click', function () {
  var cand = LP.cand; if (!cand) return;
  var idx = cand.site ? SITES.indexOf(cand.site) : -1;
  if (idx < 0) SITES.forEach(function (s, i) { if (Math.abs(s.lat - cand.lat) < 1e-5 && Math.abs(s.lon - cand.lon) < 1e-5) idx = i; });
  if (idx < 0 && cand.survey !== null && cand.survey !== undefined) {
    var p = SURVEY.pts[cand.survey], mask = {}, slope = { '20m': p[3] }; mask[String(SURVEY.meta.hobs_m)] = i16b64(FIND.masks[cand.survey]);
    if (p[4] !== null && p[4] !== undefined) slope['5m'] = p[4];
    var s = makeSite({ name: cand.name, lat: cand.lat, lon: cand.lon, terr: { dem: (p[6] ? ['5 m'] : []).concat(['20 m', '240 m']), mask: mask, h_m: p[2], slope: slope, from: 'survey point, ' + SURVEY.meta.nb + ' azimuth bins' } }, true);
    computeSite(s); SITES.push(s); saveCustom(); renderSiteSel(); idx = SITES.length - 1;
  }
  if (idx < 0) return;
  if (FIND.M) gotoTime(FIND.M.t0 + 3600000);
  selectSite(idx); setView('site');
});
function lpForSite(idx) {
  var s = SITES[idx];
  setView('find');
  lpSet({ name: s.name, lat: s.lat, lon: s.lon, survey: null, site: s });
  $('lpCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function findEnter() {
  if (!$('fStart').value) $('fStart').value = new Date(Math.floor(S.tMs / DAY) * DAY).toISOString().slice(0, 10);
  findCompute(); drawLp();
}
(function () { $('fColor').innerHTML = GOALS.map(function (g) { return '<option value="' + g.k + '">' + g.name + '</option>'; }).join('') + '<option value="ref">18.6-year average sunlight (PGDA map)</option>'; })();
