/* ================= find a site ================= */
/* Every point of the built-in survey (data/survey.json: one real LOLA horizon mask per 5.04 km cell south of
   85 S) is evaluated for the operator's own landing date and surface stay, then filtered by ranges the user sets.
   Two derived scores, asked for by Sharif for preliminary filtering and for the general public, sum up the
   numbers below them; the numbers themselves stay available as sub-constraints for mission operators:
     Solar availability = 100 x mean of [ mean irradiance / mean full-disk irradiance,
                                          lowest 24 h mean irradiance / mean full-disk irradiance,
                                          1 - longest darkness / stay length ]
     Earth availability = 100 x mean of [ share of time with a link, 1 - longest outage / stay length ]
   Equal weights; each term is a fraction from 0 to 1 with a physical meaning, so a score of 100 means full Sun
   (or link) all the time. "Full-disk irradiance" is 1361 W/m2 x (1 au / Sun distance)^2 averaged over the stay, so
   the first two terms are independent of the season's Sun distance. A sub-constraint that is set freezes its score.
   Nothing else is ranked: a point either lies inside every range or it does not, and the funnel shows which range
   removes how many. A selected candidate can be opened as a site in the Site view. */
var FIND = { ready: false, loading: false, fail: false, geos: null, xy: null, masks: null, met: null, key: null, token: 0, M: null, sel: -1, pass: null, inArea: null, order: [], view: null, geom: null, fallback: false,
  lim: {}, dom: {}, sortK: 'sol', sortDir: -1, hashG: '', rows: 'pass', filt: '', showAll: false };
function f1(v) { return v.toFixed(1); }
var CONS = [
  { k: 'sol', name: 'Solar availability', unit: 'score', max: true, fmt: function (v) { return Math.round(v) + ''; }, subs: ['irr', 'day', 'dark'], learn: 'southpole',
    about: 'Sunlight over the stay, 0 to 100: average of the share of full sunlight received, the share in the worst 24 h, and the share of the stay not spent in the longest darkness.' },
  { k: 'irr', name: 'Mean irradiance', unit: 'W/m²', max: true, fmt: function (v) { return Math.round(v) + ''; }, parent: 'sol' },
  { k: 'day', name: 'Lowest 24 h mean irradiance', unit: 'W/m²', max: true, fmt: function (v) { return Math.round(v) + ''; }, parent: 'sol' },
  { k: 'dark', name: 'Longest darkness', unit: 'h', max: false, fmt: f1, parent: 'sol' },
  { k: 'ear', name: 'Earth availability', unit: 'score', max: true, fmt: function (v) { return Math.round(v) + ''; }, subs: ['earth', 'out'], learn: 'dsn',
    about: 'Contact with Earth over the stay, 0 to 100: average of the share of time with a link and the share of the stay not spent in the longest outage.' },
  { k: 'earth', name: 'Earth link', unit: '% of time', max: true, fmt: function (v) { return Math.round(v) + ''; }, parent: 'ear' },
  { k: 'out', name: 'Longest Earth-link outage', unit: 'h', max: false, fmt: f1, parent: 'ear' },
  { k: 'slope', name: 'Slope', unit: '°', max: false, fmt: f1, about: 'LOLA slope: 5 m model over 10 m where a tile exists, else 20 m over 40 m. Not lander scale.' }
];
var CBY = {}; CONS.forEach(function (c) { CBY[c.k] = c; });
function solScore(m) { var F = m.irrFullAvg || 1361; return 100 * (Math.min(1, m.irrAvg / F) + Math.min(1, m.irrDayMin / F) + Math.max(0, 1 - m.darkMaxH / m.periodH)) / 3; }
function earScore(m) { return 100 * (m.earthFrac + Math.max(0, 1 - m.outMaxH / m.periodH)) / 2; }
function surveySlope(p) { return p[4] !== null && p[4] !== undefined ? p[4] : p[3]; }
function cval(k, j) {
  if (k === 'ref') return SURVEY.pts[j][5];
  if (k === 'slope') return surveySlope(SURVEY.pts[j]);
  var m = FIND.met[j];
  return k === 'sol' ? solScore(m) : k === 'ear' ? earScore(m) : k === 'irr' ? m.irrAvg : k === 'day' ? m.irrDayMin : k === 'dark' ? m.darkMaxH : k === 'earth' ? m.earthFrac * 100 : m.outMaxH;
}
/* A range is active when it is narrower than the data's domain. */
function limOf(k) { var l = FIND.lim[k], d = FIND.dom[k]; if (!l || !d) return null; return l[0] > d[0] + 1e-9 || l[1] < d[1] - 1e-9 ? l : null; }
function frozen(c) { return !!c.subs && c.subs.some(function (k) { return limOf(k); }); }
function activeLims() { return CONS.filter(function (c) { return limOf(c.k); }).map(function (c) { return { c: c, l: limOf(c.k) }; }); }
function inLim(q, j) { var v = cval(q.c.k, j); return v >= q.l[0] - 1e-9 && v <= q.l[1] + 1e-9; }
function limText(q) { var d = FIND.dom[q.c.k], u = q.c.unit === 'score' ? '' : ' ' + q.c.unit; return q.c.name + ' ' + (q.l[0] <= d[0] + 1e-9 ? '≤ ' + q.c.fmt(q.l[1]) : q.l[1] >= d[1] - 1e-9 ? '≥ ' + q.c.fmt(q.l[0]) : q.c.fmt(q.l[0]) + ' to ' + q.c.fmt(q.l[1])) + u + (q.c.subs && frozen(q.c) ? ' (frozen)' : ''); }

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
  if (FIND.key === M.key) { findApply(); return; }
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
    findDomains(); findApply();
  })();
}
/* Slider domains from the data: scores and Earth link 0 to 100; darkness and outage 0 to the stay; irradiance and
   slope 0 to the largest value in the survey. A range the user set is kept (clipped to the new domain). */
function findDomains() {
  var P = SURVEY.pts, n = P.length, mx = { irr: 0, day: 0, slope: 0 }, H = FIND.met[0].periodH;
  for (var j = 0; j < n; j++) { mx.irr = Math.max(mx.irr, FIND.met[j].irrAvg); mx.day = Math.max(mx.day, FIND.met[j].irrDayMin); mx.slope = Math.max(mx.slope, surveySlope(P[j])); }
  var D = { sol: [0, 100], ear: [0, 100], earth: [0, 100], irr: [0, Math.ceil(mx.irr / 10) * 10], day: [0, Math.ceil(mx.day / 10) * 10], dark: [0, Math.ceil(H)], out: [0, Math.ceil(H)], slope: [0, Math.ceil(mx.slope)] };
  var old = FIND.dom; FIND.dom = D;
  CONS.forEach(function (c) {
    var l = FIND.lim[c.k], d = D[c.k], od = old[c.k];
    if (!l || (od && l[0] <= od[0] + 1e-9 && l[1] >= od[1] - 1e-9)) FIND.lim[c.k] = d.slice();
    else FIND.lim[c.k] = [clamp(l[0], d[0], d[1]), clamp(l[1], d[0], d[1])];
  });
  if (FIND.hashG) { readGHash(FIND.hashG); FIND.hashG = ''; }
  buildCons();
}

/* ---------- the double-ended sliders ---------- */
function stepOfDom(d) { var r = d[1] - d[0]; return r <= 20 ? 0.1 : r <= 200 ? 1 : 5; }
function consHTML(c) {
  var d = FIND.dom[c.k], st = stepOfDom(d), l = FIND.lim[c.k];
  return '<div class="cons' + (c.subs ? ' parent' : '') + '" data-k="' + c.k + '">' +
    '<h4>' + c.name + ' <span class="mu">' + (c.unit === 'score' ? '0 to 100' : c.unit) + '</span>' + (c.learn ? ' ' + learn(c.learn) : '') + '</h4>' +
    (c.about ? '<div class="lbl"><span>' + c.about + '</span></div>' : '') +
    '<div class="dual"><input type="number" class="lo" aria-label="' + c.name + ', from" step="' + st + '" min="' + d[0] + '" max="' + d[1] + '" value="' + +l[0].toFixed(1) + '">' +
    '<div class="rng"><div class="trk"></div><div class="on"></div><input type="range" class="a" aria-label="' + c.name + ', lower end" min="' + d[0] + '" max="' + d[1] + '" step="' + st + '" value="' + l[0] + '"><input type="range" class="b" aria-label="' + c.name + ', upper end" min="' + d[0] + '" max="' + d[1] + '" step="' + st + '" value="' + l[1] + '"></div>' +
    '<input type="number" class="hi" aria-label="' + c.name + ', to" step="' + st + '" min="' + d[0] + '" max="' + d[1] + '" value="' + +l[1].toFixed(1) + '"></div>' +
    (c.subs ? '<div class="frz" hidden></div><details class="sub"' + (c.subs.some(function (k) { return limOf(k); }) ? ' open' : '') + '><summary>Set the parts (mission operators)</summary><div class="subs">' + c.subs.map(function (k) { return consHTML(CBY[k]); }).join('') + '</div></details>' : '') +
    '</div>';
}
function buildCons() {
  $('fCons').innerHTML = CONS.filter(function (c) { return !c.parent; }).map(consHTML).join('');
  syncCons();
}
/* Paint every slider from FIND.lim; a parent with a set part is frozen (disabled, kept at its range). */
function syncCons() {
  Array.prototype.forEach.call(document.querySelectorAll('#fCons .cons'), function (box) {
    var k = box.getAttribute('data-k'), c = CBY[k], d = FIND.dom[k], l = FIND.lim[k]; if (!d || !l) return;
    var dual = box.querySelector(':scope > .dual'), a = dual.querySelector('.a'), b = dual.querySelector('.b'), on = dual.querySelector('.on');
    a.value = l[0]; b.value = l[1];
    if (document.activeElement !== dual.querySelector('.lo')) dual.querySelector('.lo').value = +(+l[0]).toFixed(1);
    if (document.activeElement !== dual.querySelector('.hi')) dual.querySelector('.hi').value = +(+l[1]).toFixed(1);
    var r = d[1] - d[0] || 1; on.style.left = 'calc(6px + ' + ((l[0] - d[0]) / r * 100) + '% - ' + ((l[0] - d[0]) / r * 12) + 'px)'; on.style.width = 'calc(' + ((l[1] - l[0]) / r * 100) + '% - ' + ((l[1] - l[0]) / r * 12) + 'px)';
    if (c.subs) {
      var fz = frozen(c), msg = box.querySelector(':scope > .frz');
      box.classList.toggle('frozen', fz);
      Array.prototype.forEach.call(dual.querySelectorAll('input'), function (x) { x.disabled = fz; });
      msg.hidden = !fz; msg.innerHTML = fz ? 'Frozen at its current range because a part below is set. <button type="button" class="link" data-unfreeze="' + k + '">Clear the parts</button>' : '';
    }
  });
}
var consTimer = 0;
function setLim(k, lo, hi, quick) {
  var d = FIND.dom[k]; if (!d) return;
  lo = clamp(isFinite(lo) ? lo : d[0], d[0], d[1]); hi = clamp(isFinite(hi) ? hi : d[1], d[0], d[1]);
  if (lo > hi) { var t = lo; lo = hi; hi = t; }
  FIND.lim[k] = [lo, hi]; syncCons();
  clearTimeout(consTimer); consTimer = setTimeout(function () { findApply(); writeHash(); }, quick ? 60 : 0);
}
$('fCons').addEventListener('input', function (e) {
  var box = e.target.closest('.cons'); if (!box || e.target.type !== 'range') return;
  var k = box.getAttribute('data-k'), dual = e.target.closest('.dual'), a = +dual.querySelector('.a').value, b = +dual.querySelector('.b').value;
  if (e.target.classList.contains('a') && a > b) a = b; if (e.target.classList.contains('b') && b < a) b = a;
  setLim(k, a, b, true);
});
$('fCons').addEventListener('change', function (e) {
  var box = e.target.closest('.cons'); if (!box || e.target.type !== 'number') return;
  var k = box.getAttribute('data-k'), dual = e.target.closest('.dual'), v = parseFloat(e.target.value), l = FIND.lim[k].slice(), d = FIND.dom[k];
  if (e.target.classList.contains('lo')) l[0] = isFinite(v) ? v : d[0]; else l[1] = isFinite(v) ? v : d[1];
  setLim(k, l[0], l[1], false);
});
$('fCons').addEventListener('click', function (e) {
  var b = e.target.closest('[data-unfreeze]'); if (!b) return;
  CBY[b.getAttribute('data-unfreeze')].subs.forEach(function (k) { FIND.lim[k] = FIND.dom[k].slice(); });
  syncCons(); findApply(); writeHash();
});
$('fReset').addEventListener('click', function () { CONS.forEach(function (c) { if (FIND.dom[c.k]) FIND.lim[c.k] = FIND.dom[c.k].slice(); }); syncCons(); findApply(); writeHash(); });
/* Hash: g=k:lo:hi,... for the ranges that are set. */
function gHash() { return activeLims().map(function (q) { return q.c.k + ':' + +q.l[0].toFixed(2) + ':' + +q.l[1].toFixed(2); }).join(','); }
function readGHash(v) { (v || '').split(',').forEach(function (t) { var p = t.split(':'); if (CBY[p[0]] && FIND.dom[p[0]]) { var d = FIND.dom[p[0]]; FIND.lim[p[0]] = [clamp(+p[1], d[0], d[1]), clamp(+p[2], d[0], d[1])]; } }); }

/* ---------- the "when a moment counts" editor, inside the finder ---------- */
$('fLimEdit').addEventListener('click', function () {
  var ed = $('fLimEd'), on = ed.hidden; ed.hidden = !on; this.setAttribute('aria-expanded', on ? 'true' : 'false'); this.textContent = on ? 'Done' : 'Change';
  $('fLinkMin').value = S.linkMin; $('fGround').checked = S.ground;
});
$('fLinkMin').addEventListener('change', function () { var v = parseFloat(this.value); S.linkMin = clamp(isFinite(v) ? v : 0, 0, 60); this.value = S.linkMin; $('linkMin').value = S.linkMin; recompute(false); findCompute(); });
$('fGround').addEventListener('change', function () { S.ground = this.checked; $('ground').checked = S.ground; recompute(true); });

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
  var P = SURVEY.pts, n = P.length, lims = activeLims(), area = readArea(), pass = new Uint8Array(n), inA = new Uint8Array(n), k, left = [], inList = [];
  for (k = 0; k < n; k++) if (inArea(area, P[k][0], P[k][1])) { inA[k] = 1; left.push(k); }
  inList = left.slice();
  var html = '<li><b>Survey points' + (area.active ? ' in your area' : ', 85°S to the pole') + '</b><span>' + left.length.toLocaleString('en-US') + '</span></li>', n0 = Math.max(1, left.length);
  lims.forEach(function (q) {
    left = left.filter(function (j) { return inLim(q, j); });
    html += '<li><b>' + esc(limText(q)) + '</b><span>' + left.length.toLocaleString('en-US') + ' left</span><div class="bar2"><i style="width:' + (left.length / n0 * 100).toFixed(1) + '%"></i></div></li>';
  });
  html += '<li class="end"><b>' + (lims.length ? 'Inside every range' : 'No range set: all shown') + '</b><span>' + left.length.toLocaleString('en-US') + '</span></li>';
  $('funnel').innerHTML = html;
  left.forEach(function (j) { pass[j] = 1; });
  var ck = $('fColor').value, cg = CBY[ck];
  function cv(j) { return cval(ck, j); }
  var order = left.slice().sort(function (a, b) { return (cg && !cg.max ? 1 : -1) * (cv(a) - cv(b)); });
  var lo = Infinity, hi = -Infinity; order.forEach(function (j) { var v = cv(j); if (v < lo) lo = v; if (v > hi) hi = v; });
  FIND.pass = pass; FIND.inArea = inA; FIND.inList = inList; FIND.order = order; FIND.cv = cv; FIND.crng = [lo, hi]; FIND.cmax = !(cg && !cg.max); FIND.lims = lims; FIND.area = area;
  // the map shrinks to the points that are left
  var H0 = POLAR.half_m, view = { cx: 0, cy: 0, half: H0 };
  if ((lims.length || area.active) && order.length) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    order.forEach(function (j) { var p = FIND.xy[j]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
    view.half = clamp(Math.max(x1 - x0, y1 - y0) / 2 * 1.25 + 4000, 15000, H0);
    view.cx = clamp((x0 + x1) / 2, -H0 + view.half, H0 - view.half); view.cy = clamp((y0 + y1) / 2, -H0 + view.half, H0 - view.half);
  }
  FIND.view = view;
  drawFmap(); findTable(); findNote();
  if (FIND.sel >= 0) $('fSel').textContent = 'Selected: ' + candText(FIND.sel);
}
function findNote() {
  var M = FIND.M, m = SURVEY.meta;
  $('fStatus').textContent = '';
  $('fSurveyNote').textContent = 'Period: ' + iso(M.t0).slice(0, 10) + ' to ' + iso(M.t0 + M.days * DAY).slice(0, 10) + ' UTC.';
  $('fNote').innerHTML = '<b>What the candidates are.</b> ' + SURVEY.pts.length.toLocaleString('en-US') + ' points, one per ' + m.cell_km + ' km cell from 85°S to the pole, each placed on the cell\'s brightest pixel in the PGDA 18.6-year average-visibility map. That map only chooses where the point sits. Every number here is computed for your dates from the point\'s own LOLA horizon mask (' + m.hobs_m + ' m observer, ' + m.nb + ' azimuth bins), sampled every ' + M.stepMin + ' min' + (FIND.fallback ? ', <b>with the fallback ephemeris for part of the period</b>' : '') + '. ' +
    'Irradiance is on a Sun-facing surface: 1361 W/m² at 1 au, scaled by the Sun\'s distance and the visible fraction of its disk. Slope is from the 5 m model over a 10 m baseline where a 5 m tile exists, otherwise from the 20 m mosaic over 40 m. ' + esc(linkRuleText()) + ' ' +
    '<b>The two scores.</b> Solar availability = 100 × the average of three fractions: mean irradiance ÷ mean full-disk irradiance, lowest 24 h mean ÷ mean full-disk irradiance, and 1 − longest darkness ÷ stay length. Earth availability = 100 × the average of the share of time with a link and 1 − longest outage ÷ stay length. Equal weights, no other input: they are a summary for a first cut, not a judgement of a site; the numbers under them are what a mission should check. ' +
    '<b>What this cannot tell you.</b> A 5 km cell holds better and worse ground than its one point, so an empty map means no <i>survey point</i> meets the ranges, not that no ground does. Elevation-model error is not quantified for survey points.';
}
function fmtLat(lat) { return Math.abs(lat).toFixed(3) + '°' + (lat < 0 ? 'S' : 'N'); }
/* Light red (worst in the area) to light green (best in the area), per column. */
function heat(u) { u = clamp(u, 0, 1); return 'hsl(' + Math.round(u * 120) + ',62%,' + (90 - 4 * Math.sin(u * Math.PI)).toFixed(0) + '%)'; }
var FCOLS = [['sol', 'Solar score'], ['ear', 'Earth score'], ['irr', 'Mean W/m²'], ['day', 'Lowest 24 h W/m²'], ['dark', 'Longest dark'], ['earth', 'Earth link'], ['out', 'Longest outage'], ['slope', 'Slope'], ['ref', '18.6-yr avg sun']];
function findTable() {
  var P = SURVEY.pts, base = FIND.rows === 'all' ? FIND.inList : FIND.order, f = FIND.filt.trim();
  if (f) base = base.filter(function (j) { return (fmtLat(P[j][0]) + ' ' + P[j][1].toFixed(2) + '°E').indexOf(f) >= 0; });
  var k = FIND.sortK, dir = FIND.sortDir;
  var rows = base.slice().sort(function (a, b) { return dir * (cval(k, a) - cval(k, b)); }), cap = FIND.showAll ? rows.length : Math.min(rows.length, 150);
  // per-column ranges over all points in the area, for the cell colours
  var R = {}; FCOLS.forEach(function (c) { var lo = Infinity, hi = -Infinity; FIND.inList.forEach(function (j) { var v = cval(c[0], j); if (v < lo) lo = v; if (v > hi) hi = v; }); R[c[0]] = [lo, hi]; });
  function cell(c, j) {
    var v = cval(c, j), r = R[c], g = CBY[c], good = c === 'ref' || (g && g.max), u = r[1] > r[0] ? (v - r[0]) / (r[1] - r[0]) : 1; if (!good) u = 1 - u;
    var txt = c === 'dark' || c === 'out' ? fmtHours(v) : c === 'earth' ? Math.round(v) + '%' : c === 'slope' ? v.toFixed(1) + '°' : c === 'ref' ? Math.round(v) + '%' : Math.round(v) + '';
    return '<td class="heat" style="background:' + heat(u) + '">' + txt + '</td>';
  }
  var h = '<tr><th data-fk="pos">Candidate</th>' + FCOLS.map(function (c) { return '<th data-fk="' + c[0] + '"' + (c[0] === k ? ' aria-sort="' + (dir > 0 ? 'ascending' : 'descending') + '"' : '') + ' title="Sort by this column">' + c[1] + (c[0] === k ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '</tr>';
  if (!rows.length) h += '<tr><td colspan="10" style="text-align:left;color:var(--mute)">' + (FIND.rows === 'pass' ? 'No survey point lies inside every range' + (FIND.area.active ? ' in this area' : '') + '. The funnel on the left shows which range removes the most; widen that one first.' : 'No point matches.') + '</td></tr>';
  rows.slice(0, cap).forEach(function (j) {
    var p = P[j];
    h += '<tr data-k="' + j + '"' + (j === FIND.sel ? ' class="sel"' : '') + ' style="cursor:pointer' + (FIND.pass[j] ? '' : ';opacity:.6') + '"><td>' + fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E</td>' + FCOLS.map(function (c) { return cell(c[0], j); }).join('') + '</tr>';
  });
  if (rows.length > cap) h += '<tr><td colspan="10" style="text-align:left"><button type="button" class="link" id="fMore">Show all ' + rows.length.toLocaleString('en-US') + ' rows</button></td></tr>';
  $('fTable').innerHTML = h;
  $('fCount').textContent = rows.length.toLocaleString('en-US') + ' row' + (rows.length === 1 ? '' : 's') + (FIND.rows === 'all' ? ' (faded: outside a range)' : '');
}
$('fTable').addEventListener('click', function (e) {
  if (e.target.id === 'fMore') { FIND.showAll = true; findTable(); return; }
  var th = e.target.closest('th[data-fk]');
  if (th) { var k = th.getAttribute('data-fk'); if (k === 'pos') return; if (FIND.sortK === k) FIND.sortDir = -FIND.sortDir; else { FIND.sortK = k; FIND.sortDir = CBY[k] && !CBY[k].max ? 1 : -1; } findTable(); return; }
  var tr = e.target.closest('tr[data-k]'); if (tr) selectCandidate(+tr.getAttribute('data-k'));
});
$('fRows').addEventListener('change', function () { FIND.rows = this.value; FIND.showAll = false; findTable(); });
$('fFilt').addEventListener('input', function () { FIND.filt = this.value; FIND.showAll = false; findTable(); });
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
  c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 1; c.font = '10px "Segoe UI", Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'left'; c.textBaseline = 'bottom';
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
    var ck = $('fColor').value, g = CBY[ck], f = g ? function (v) { return g.fmt(v) + (g.unit === 'score' ? '' : ' ' + g.unit); } : function (v) { return Math.round(v) + '%'; }, gx = w - 150;
    for (var q3 = 0; q3 < 60; q3++) { c.fillStyle = ramp(q3 / 59); c.fillRect(gx + q3, w - 11, 1.5, 6); }
    c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(f(FIND.cmax ? FIND.crng[0] : FIND.crng[1]), gx - 5, w - 4); c.textAlign = 'left'; c.fillText(f(FIND.cmax ? FIND.crng[1] : FIND.crng[0]), gx + 64, w - 4);
  }
  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(255,255,255,.6)';
  if (V.half >= H0 * 0.98) c.fillText('0° (Earth side)', w / 2, 4);
  FIND.geom = { pts: pts };
}
function candText(j) {
  var p = SURVEY.pts[j], m = FIND.met[j];
  return fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E, height ' + Math.round(p[2]) + ' m: solar score ' + Math.round(solScore(m)) + ', Earth score ' + Math.round(earScore(m)) + '; mean ' + wm2(m.irrAvg) + ', lowest 24 h mean ' + wm2(m.irrDayMin) + ', longest dark ' + fmtHours(m.darkMaxH) + ', Earth link ' + pct(m.earthFrac) + ', longest outage ' + fmtHours(m.outMaxH) + ', slope ' + surveySlope(p).toFixed(1) + '°' + (FIND.pass[j] ? '' : ' · outside a range');
}
function fmapNearest(e, cv) {
  if (!FIND.geom) return -1;
  var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = 14;
  FIND.geom.pts.forEach(function (p) { var d = Math.hypot(p.x - x, p.y - y) - (FIND.pass[p.k] ? 3 : 0); if (d < bd) { bd = d; best = p.k; } });
  return best;
}
$('fmap').addEventListener('pointermove', function (e) { var j = fmapNearest(e, this); $('fRead').textContent = j >= 0 ? candText(j) + ' · click to select' : 'Bright dots lie inside every range; faint dots are survey points that do not. Squares are the listed sites.'; });
$('fmap').addEventListener('click', function (e) { var j = fmapNearest(e, this); if (j >= 0) selectCandidate(j); });
function selectCandidate(j) {
  FIND.sel = j;
  $('fRead').textContent = '';
  $('fSel').textContent = 'Selected: ' + candText(j);
  $('fOpen').disabled = false;
  drawFmap(); findTable();
}
['fStart', 'fDays'].forEach(function (id) { $(id).addEventListener('change', findCompute); });
['fLat0', 'fLat1', 'fLon0', 'fLon1', 'fColor'].forEach(function (id) { $(id).addEventListener('change', function () { findApply(); writeHash(); }); });
/* Open the selected candidate in the Site view. A survey point becomes one of the operator's sites, with its own mask. */
$('fOpen').addEventListener('click', function () {
  var j = FIND.sel; if (j < 0) return;
  var p = SURVEY.pts[j], lat = p[0], lon = ((p[1] + 540) % 360) - 180, idx = -1;
  SITES.forEach(function (s, i) { if (Math.abs(s.lat - lat) < 1e-5 && Math.abs(s.lon - lon) < 1e-5) idx = i; });
  if (idx < 0) {
    var mask = {}, slope = { '20m': p[3] }; mask[String(SURVEY.meta.hobs_m)] = i16b64(FIND.masks[j]);
    if (p[4] !== null && p[4] !== undefined) slope['5m'] = p[4];
    var s = makeSite({ name: 'Survey point ' + fmtLat(p[0]) + ' ' + p[1].toFixed(2) + '°E', lat: lat, lon: lon, terr: { dem: (p[6] ? ['5 m'] : []).concat(['20 m', '240 m']), mask: mask, h_m: p[2], slope: slope, from: 'survey point, ' + SURVEY.meta.nb + ' azimuth bins' } }, true);
    computeSite(s); SITES.push(s); saveCustom(); renderSiteSel(); idx = SITES.length - 1;
  }
  if (FIND.M) gotoTime(FIND.M.t0 + 3600000);
  selectSite(idx); setView('site');
});
function findEnter() {
  if (!$('fStart').value) $('fStart').value = new Date(Math.floor(S.tMs / DAY) * DAY).toISOString().slice(0, 10);
  $('fLinkMin').value = S.linkMin; $('fGround').checked = S.ground;
  findCompute();
}
(function () { $('fColor').innerHTML = CONS.map(function (g) { return '<option value="' + g.k + '">' + g.name + '</option>'; }).join('') + '<option value="ref">18.6-year average sunlight (PGDA map)</option>'; })();
