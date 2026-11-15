/* ================= UI ================= */
function renderSiteSel() {
  var h = '';
  CATS.forEach(function (cat) {
    var o = '';
    SITES.forEach(function (s, idx) { if (s.cat === cat[0]) o += '<option value="' + idx + '">' + esc(s.name) + '</option>'; });
    if (o) h += '<optgroup label="' + cat[1] + '">' + o + '</optgroup>';
  });
  $('siteSel').innerHTML = h + '<option value="add">+ Add your own site…</option>'; $('siteSel').value = String(S.sel);
}
$('siteSel').addEventListener('change', function () {
  if (this.value === 'add') { this.value = String(S.sel); setView('list'); setAddOpen(true); return; }
  selectSite(+this.value);
});
function assumptions(s) {
  var mh = maskHeight(s);
  var a = ['Terrain: ' + terrLabel(s) + ', observer ' + (mh === null ? S.hobs : mh) + ' m above ' + (s.terr ? 'ground' : 'the sphere') + (s.terr && mh !== S.hobs ? ' (no ' + S.hobs + ' m mask for this point)' : '')];
  a.push('Ephemeris: ' + (STEPS.fallback ? 'astronomy-engine fallback (IAU frame)' : 'SPICE DE440, MOON_ME'));
  a.push('Limits: ' + limitsList().join('; '));
  a.push('Irradiance: 1361 W/m² at 1 au × (1 au / Sun distance)² × visible disk fraction, on a Sun-facing surface');
  a.push('Exact landing point'); a.push('Events root-found to 1 s from 10-min samples');
  return a.join(' · ');
}
/* A headline tile: one key, one number, one line. Everything else goes in the stats block below the tiles. */
function tile(cls, k, big, sub, meter) {
  return '<div class="tile ' + cls + '"><span class="k">' + k + '</span><span class="big">' + big + '</span>' + (meter === undefined ? '' : '<span class="meter"><i style="width:' + Math.round(clamp(meter, 0, 1) * 100) + '%"></i></span>') + '<span class="sub">' + sub + '</span></div>';
}
function statGroup(title, rows) {
  return '<div><h4>' + title + '</h4><dl>' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl></div>';
}
function sunWord() { return S.sunFracMin >= 1 ? 'whole disk' : S.sunFracMin > 0 ? 'half disk' : 'any part'; }
var NOWC = null; // the last headline computation, reused by the uncertainty table
function updateNow() {
  var s = SITES[S.sel], I = nowInfo(s), L = I.L, left = Math.max(1, Math.floor((I.endMs - S.tMs) / DAY)), h = '';
  function rel(v) { return v >= 0 ? deg2(v) + ' above' : deg2(-v) + ' below'; }
  // Sun: time to the next change at the user's threshold, to the minute
  var setW = S.sunFracMin > 0 ? 'Sun below ' + sunWord() : 'Sunset', riseW = S.sunFracMin > 0 ? 'Sun back to ' + sunWord() : 'Sunrise';
  var bigS, bigE, sub, thr = S.sunFracMin > 0;
  if (I.sunUp) bigS = I.sunNext ? setW + ' in ' + fmtSpan(I.sunNext.t - S.tMs) : (thr ? 'Sun stays at ' + sunWord() + ' or more for the next ' + left + ' days' : 'No sunset in the next ' + left + ' days');
  else bigS = I.sunNext ? riseW + ' in ' + fmtSpan(I.sunNext.t - S.tMs) : (thr ? 'Sun stays below ' + sunWord() + ' for the next ' + left + ' days' : 'No sunrise in the next ' + left + ' days');
  sub = 'Elevation ' + deg2(L.sunEl) + ' now, ' + pct(L.sunFrac) + ' of the disk visible' + (I.sunNext ? ' · ' + fmtDT(I.sunNext.t) + (thr ? '' : (I.sunUp ? ' (last light)' : ' (first light)')) : '');
  h += tile('sun' + (I.sunUp ? '' : ' off'), 'Sun · ' + sunWord() + ' visible', bigS, sub, L.sunFrac);
  // Earth: time to loss / return of the line of sight at the user's margin
  var far = L.earthEl < -15 && !I.earthNext, lim = S.linkMin ? ' by ' + S.linkMin + '°' : '';
  if (I.earthUp) bigE = I.earthNext ? 'Earthset in ' + fmtSpan(I.earthNext.t - S.tMs) : 'Earth in view throughout';
  else bigE = far ? 'Earth never in view' : I.earthNext ? 'Earthrise in ' + fmtSpan(I.earthNext.t - S.tMs) : 'No Earthrise in the next ' + left + ' days';
  sub = far ? 'Far side: Earth is never above the horizon here' : 'Elevation ' + deg2(L.earthEl) + ' now, ' + rel(L.earthMargin) + ' the skyline' + (I.earthNext ? ' · ' + fmtDT(I.earthNext.t) : '');
  h += tile('earth' + (I.earthUp ? '' : ' off'), 'Earth · centre clears the skyline' + lim, bigE, sub, L.earthFrac);
  var P = periodStats(s, stepOf(S.tMs)), days = Math.round(P.days);
  h += tile('period', 'Mean irradiance · next ' + days + ' days', wm2(P.irrAvg), 'Sun in view ' + pct(P.litFrac) + ' of the time · ' + linkWord() + ' ' + pct(P.earthFrac), P.irrAvg / L.irrFull);
  $('vNow').innerHTML = h;
  var nowRows = [
    ['Irradiance', wm2(L.irr) + ' of ' + wm2(L.irrFull)],
    ['Sun centre', deg2(L.sunEl) + ' · az ' + L.sunAz.toFixed(1) + '°'],
    ['Skyline under the Sun', deg2(L.sunHor)],
    ['Earth centre', deg2(L.earthEl) + ' · az ' + L.earthAz.toFixed(1) + '°'],
    ['Earth disk visible', pct(L.earthFrac)]
  ];
  var perRows = [
    ['Lowest 24 h mean irradiance', wm2(P.irrDayMin)],
    ['Longest darkness', fmtHours(P.darkMaxH)],
    [satsOn().length ? 'Longest outage (direct and relay)' : 'Longest Earth-link outage', fmtHours(P.outMaxH)],
    ['Limits met', fmtDur(s.lastSum ? s.lastSum.openSteps : 0)]
  ];
  if (slopeText(s) !== 'n/a') perRows.push(['Slope (LOLA grid)', slopeText(s)]);
  $('vStats').innerHTML = noTerrainPolar(s) ? '' : statGroup('Now, at ' + fmtDT(S.tMs), nowRows) + statGroup('Next ' + days + ' days', perRows);
  // the same headline over the sky
  $('heroNow').innerHTML = noTerrainPolar(s) ? '<span class="big off">No terrain model for this point</span><span class="sitemeta">Near the pole a smooth sphere is not a usable horizon. Numbers below should not be used.</span>'
    : '<span class="big ' + (I.sunUp ? 's' : 'off') + '">' + bigS + '</span><span class="big ' + (I.earthUp ? 'e' : 'off') + '">' + bigE + '</span><span class="sitemeta">' + wm2(L.irr) + ' now · ' + wm2(P.irrAvg) + ' mean over ' + days + ' d</span>';
  NOWC = { s: s, I: I, P: P, setW: setW, riseW: riseW };
  showUncertainty(null);
}
/* The uncertainty card: each headline number next to its range across the LOLA error clones. u null: pending. */
var uncTimer = null;
function cloneEvent(C, up, edges, nomUp) {
  if (up !== C.n && up !== 0) return 'The clones disagree about now (' + up + ' of ' + C.n + ' say in view), so no time range is given';
  if ((up === C.n) !== nomUp) return 'All clones give the opposite state to the nominal model now';
  var ts = edges.filter(function (t) { return t !== null; }), none = C.n - ts.length;
  if (!ts.length) return 'None in the computed range in any clone';
  var r = rangeOf(ts);
  return (r[1] - r[0] < 60000 ? fmtDT(r[0]) + ' in every clone that has one (under a minute apart)' : fmtDT(r[0]) + ' to ' + fmtDT(r[1]) + ' (' + fmtSpan(r[1] - r[0]) + ' apart)') + (none ? '; none in ' + none + ' clone' + (none > 1 ? 's' : '') : '');
}
function showUncertainty(u) {
  var s = SITES[S.sel], head = $('uHead'), tb = $('uTable');
  $('vTerrUnc').textContent = terrUnc(s);
  if (!NOWC || NOWC.s !== s) { tb.innerHTML = ''; return; }
  if (!s.terr) { head.textContent = 'No terrain model here, so terrain uncertainty is not quantified.'; tb.innerHTML = ''; return; }
  var hasClones = !s.custom && s.id && CLONES.sites[s.id];
  if (!u) { head.textContent = hasClones || s.terr.grid ? 'Recomputed on the error models when the dial rests…' : 'Elevation-model error is not quantified for this point: PGDA error clones (Barker et al. 2021) exist only for its 5 m site models.'; tb.innerHTML = ''; return; }
  var C = u.clones, I = NOWC.I, P = NOWC.P, rows = [];
  head.textContent = C ? 'Each number below is recomputed on ' + C.n + ' LOLA error-clone elevation models (Barker et al. 2021). The range covers elevation-model error only and is not a confidence interval.'
    : 'Elevation-model error is not quantified for this point (no clone DEMs).' + (u.near ? ' The row below shows how much the answer moves with landing position instead.' : '');
  if (C) {
    rows.push([I.sunUp ? NOWC.setW : NOWC.riseW, I.sunNext ? fmtDT(I.sunNext.t) : 'none in range', cloneEvent(C, C.sunUp, C.sunEdge, I.sunUp)]);
    rows.push([I.earthUp ? 'Earthset' : 'Earthrise', I.earthNext ? fmtDT(I.earthNext.t) : 'none in range', cloneEvent(C, C.earthUp, C.earthEdge, I.earthUp)]);
    var a = rangeOf(C.lit), b = rangeOf(C.irr);
    rows.push(['Mean irradiance, next ' + Math.round(P.days) + ' d', wm2(P.irrAvg), Math.round(b[0]) + ' to ' + wm2(b[1])]);
    rows.push(['Sun in view, next ' + Math.round(P.days) + ' d', pct(P.litFrac), pct(a[0]) + ' to ' + pct(a[1])]);
  }
  if (u.near) rows.push(['Sun in view at the 8 grid points ' + u.near.d + ' m away (' + u.near.hobs + ' m observer)', pct(P.litFrac), pct(u.near.lit[0]) + ' to ' + pct(u.near.lit[1])]);
  tb.innerHTML = rows.length ? '<tr><th>Quantity</th><th>This model</th><th>' + (C ? 'Across ' + C.n + ' clones' : 'Range') + '</th></tr>' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') : '';
}
function scheduleUncertainty() {
  clearTimeout(uncTimer);
  uncTimer = setTimeout(function () {
    if (S.playing) return;
    var s = SITES[S.sel], t = S.tMs;
    if (!s.terr) return;
    uncertainty(s, function (u) { if (SITES[S.sel] === s && S.tMs === t) showUncertainty(u); });
  }, 300);
}
/* The terrain uncertainty at this point in plain numbers, or a statement that there is none to give. */
function terrUnc(s) {
  if (!s.terr) return 'No terrain model here, so there is nothing to quantify.';
  var c = !s.custom && s.id && CLONES.sites[s.id];
  if (!c) return 'Not quantified at this point. PGDA publishes error clones only for its 5 m site models' + (s.terr.dem[0] !== '5 m' ? ', and this skyline comes from the ' + s.terr.dem[0] + ' model' : ', and this point is not one of the sites they were processed for') + '.';
  var Q = s.clones && s.clones[maskHeight(s)];
  if (!Q || !Q.spread) return 'Reading ' + c.n + ' LOLA error clones…';
  var p = Q.spread;
  return 'Skyline scatter across ' + p.n + ' LOLA error-clone models (1σ): ' + p.rms.toFixed(3) + '° RMS over all azimuths, ' + p.worst.toFixed(2) + '° at the worst azimuth (' + Math.round(p.worstAz) + '°). Ground height ±' + p.hSd.toFixed(2) + ' m (1σ). This is near-field elevation-model error only; the far field is the same in every clone.';
}
function updateVerdict() {
  var s = SITES[S.sel], r = summarize(s, stepOf(S.tMs)), bad = noTerrainPolar(s);
  s.lastSum = r;
  var el = $('vState'); el.textContent = bad ? 'No terrain' : r.openNow ? 'Limits met now' : 'Limits not met now'; el.className = 'state' + (r.openNow && !bad ? ' on' : '');
  $('vSite').textContent = s.name; $('vCoord').textContent = fmtCoord(s.lat, s.lon) + (s.terr ? '  ' + Math.round(s.terr.h_m) + ' m' : '');
  $('vCat').textContent = (CATS.filter(function (c) { return c[0] === s.cat; })[0] || ['', ''])[1];
  $('removeSite').hidden = !s.custom;
  $('tolBtn').hidden = s.lat > -80.02;
  $('vReason').textContent = r.text;
  $('vAssume').textContent = assumptions(s);
  var badge = $('vBadge');
  if (bad) { badge.hidden = false; badge.className = 'stop'; badge.textContent = 'No terrain for this point. Near the pole the Sun and Earth sit within a few degrees of the horizon, so everything below assumes a smooth sphere and should not be used. For a real skyline, run the terrain helper (python tools/terrain/serve.py) and add the point again, pick a point within 1 km of a listed south-pole site, or take a candidate from Find a site.'; }
  else if (s.terr && s.terr.dem.length === 1) { badge.hidden = false; badge.className = 'badge'; badge.textContent = 'Horizon from the 240 m LOLA grid only: regional relief is included, nearby relief smaller than 240 m is not. At sites where the two could be compared, a 240 m horizon changed the sunlit share by up to 52 points (docs/validation.md).'; }
  else if (!s.terr && Math.abs(s.lat) >= 60) { badge.hidden = false; badge.className = 'badge'; badge.textContent = 'High-latitude site without a terrain mask: real terrain can block the low Sun and Earth here. Treat these numbers as approximate.'; }
  else badge.hidden = true;
  var fb = $('vFallback'); fb.hidden = !STEPS.fallback;
  if (STEPS.fallback) { var er = LWB.ephRange(); fb.textContent = 'Fallback ephemeris in use: part of this dial lies outside the precomputed SPICE span (' + iso(er[0]).slice(0, 10) + ' to ' + iso(er[1]).slice(0, 10) + '). Positions come from astronomy-engine with the IAU rotation model (checked to 0.003° against Horizons instead of 0.00002°).'; }
  var rows = [], H = r.H;
  rows.push(['Your limits', limitsList().join('; ')]);
  rows.push(['Time they are all met, next ' + S.horizonD + ' days', fmtDur(r.openSteps) + ' (' + Math.round(r.openSteps / Math.max(1, H) * 100) + '%), in ' + r.wins.length + ' window' + (r.wins.length === 1 ? '' : 's')]);
  r.wins.slice(0, 4).forEach(function (w, k) { rows.push(['Window ' + (k + 1), iso(w.t0) + ' to ' + iso(w.t1) + (w.cut ? ' or later' : '') + ' (' + fmtSpan(w.t1 - w.t0) + ')']); });
  if (s.terr) {
    rows.push(['Ground height', s.terr.h_m.toFixed(0) + ' m above the 1737.4 km sphere']);
    rows.push(['Skyline', deg2(s.geo.hMin) + ' to ' + deg2(s.geo.hMax) + (s.terr.stats ? ', farthest horizon point ' + s.terr.stats.max_dist_km + ' km (at 2 m)' : '')]);
    var sl = []; if (s.terr.slope && s.terr.slope['5m'] !== undefined) sl.push(s.terr.slope['5m'].toFixed(1) + '° over 10 m'); if (s.terr.slope && s.terr.slope['20m'] !== undefined) sl.push(s.terr.slope['20m'].toFixed(1) + '° over 40 m');
    if (sl.length) rows.push(['Slope (LOLA grid, B-spline gradient)', sl.join(', ') + '. Not a lander-scale slope.']);
  }
  $('vWhy').innerHTML = rows.map(function (rw) { return '<dt>' + rw[0] + '</dt><dd>' + rw[1] + '</dd>'; }).join('');
  if (s.terr && !s.custom && s.id && CLONES.sites[s.id] && !(s.clones && s.clones[maskHeight(s)])) loadClones(s).then(function () { var tu = $('vTerrUnc'); if (tu && SITES[S.sel] === s) tu.textContent = terrUnc(s); });
  $('vSrc').innerHTML = s.custom ? 'Custom site: coordinates as entered.' + (s.terr ? ' Terrain: ' + esc(terrLabel(s)) + '.' : '') :
    '<b>Coordinates</b> (ME frame): ' + esc(s.src) + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">source</a>' : '') + (s.note ? '<br>' + esc(s.note) : '');
  $('chartTitle').textContent = 'Elevation at ' + s.name;
  $('skyNote').textContent = s.geo.mask ? 'Skyline from LOLA terrain' : 'Smooth sphere, no terrain';
  updateNow();
}
function updateTime() {
  $('t').value = Math.round((S.tMs - S.startMs) / 60000);
  $('tLabel').textContent = fmtFull(S.tMs);
  if (document.activeElement !== $('tDate')) $('tDate').value = new Date(S.tMs).toISOString().slice(0, 10);
}
/* Go to a date: the time of day is kept; a date outside the period moves the period (gotoTime). */
$('tDate').addEventListener('change', function () {
  var p = this.value.split('-'); if (p.length !== 3 || !+p[0]) return;
  var day = Date.UTC(+p[0], +p[1] - 1, +p[2]); if (!isFinite(day)) return;
  if (S.playing) setPlaying(false);
  this.blur(); gotoTime(day + ((S.tMs % DAY) + DAY) % DAY);
});
/* Only the visible view is drawn: a hidden canvas has no size. Switching view redraws it. */
var lastStep = -1, lastMapDraw = 0, lastNow = 0, lastHz = 0;
function refreshData(force) {
  var i0 = stepOf(S.tMs), now = performance.now();
  if (S.view === 'site') {
    if (force || i0 !== lastStep) {
      lastStep = i0;
      if (force || !S.playing || now - lastNow > 200) { lastNow = now; updateVerdict(); drawChart(); }
      drawStrip();
    }
    if (force || now - lastMapDraw > 250) { lastMapDraw = now; drawMap(); drawPolar(); }
    if (force || now - lastHz > 120) { lastHz = now; drawHorizon(); }
    if (force) { horizonNote(); scheduleUncertainty(); slipCompute(); }
  } else if (force && S.view === 'list') {
    updateList(); drawYear(); computeYear();
    if (S.tab === 'compare') drawCompare(); else if (PF.pts.length) drawPareto();
  }
  if (force) writeHash();
}
function selectSite(idx) {
  if (idx < 0 || idx >= SITES.length) return;
  if (!SITES[idx].ready) computeSite(SITES[idx]);
  S.sel = idx; $('siteSel').value = String(idx); defaultView(); renderLook(); refreshData(true); kick();
  PF.pts = [];
  if (S.view === 'list' && S.tab === 'pareto') runPareto();
}
/* Jump the dial to a time, moving the dial's start if the time is outside it. */
function gotoTime(ms) {
  if (ms < S.startMs || ms > S.startMs + (spanSteps() - 1) * STEP_MS) {
    S.startMs = Math.floor(ms / DAY) * DAY; $('start').value = new Date(S.startMs).toISOString().slice(0, 10);
    S.tMs = ms; buildSteps(); SITES.forEach(computeSite); $('t').max = (spanSteps() - 1) * STEP_MIN;
  }
  S.tMs = ms; limSummary(); updateTime(); refreshData(true); kick();
}

/* ================= views, drawer, theme ================= */
var VIEWS = ['site', 'find', 'list', 'method'];
function setView(v) {
  if (VIEWS.indexOf(v) < 0) v = 'site';
  if (S.playing && v !== 'site') setPlaying(false);
  var changed = S.view !== v;
  S.view = v;
  VIEWS.forEach(function (k) { $('view-' + k).hidden = k !== v; });
  Array.prototype.forEach.call(document.querySelectorAll('.views button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === v ? 'true' : 'false'); });
  if (changed) window.scrollTo(0, 0);
  if (v === 'find') { findEnter(); writeHash(); }
  else if (v === 'method') writeHash();
  else { refreshData(true); if (v === 'site') kick(); else if (S.tab === 'pareto' && !PF.pts.length) runPareto(); }
}
Array.prototype.forEach.call(document.querySelectorAll('.views button'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
$('methodBtn').addEventListener('click', function () { setView('method'); });
document.addEventListener('click', function (e) { var b = e.target.closest('[data-goto]'); if (!b) return; if (!$('drawer').hidden) setDrawer(false); setView(b.getAttribute('data-goto')); });
/* One drawer holds the period, the limits and the settings; Period and Limits open it at their own section. */
var drawerFrom = null;
function setDrawer(on, at) {
  $('drawer').hidden = !on; $('scrim').hidden = !on;
  ['limBtn', 'perBtn'].forEach(function (id) { $(id).setAttribute('aria-expanded', on ? 'true' : 'false'); });
  if (on) { renderComms(); var sec = $(at || 'limH'); $('drawer').scrollTop = at === 'limH' ? Math.max(0, sec.offsetTop - 24) : 0; $('limClose').focus({ preventScroll: true }); }
  else if (drawerFrom) { drawerFrom.focus(); drawerFrom = null; }
}
$('limBtn').addEventListener('click', function () { drawerFrom = this; setDrawer($('drawer').hidden, 'limH'); });
$('perBtn').addEventListener('click', function () { drawerFrom = this; setDrawer($('drawer').hidden, 'perH'); });
$('fLimEdit').addEventListener('click', function () { drawerFrom = this; setDrawer(true, 'limH'); });
$('limClose').addEventListener('click', function () { setDrawer(false); });
$('scrim').addEventListener('click', function () { setDrawer(false); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('drawer').hidden) setDrawer(false); });
function limSummary() {
  var a = ['Sun ' + sunWord(), 'Earth ≥ ' + S.linkMin + '°'];
  if (S.sunMin !== null || S.sunMax !== null) a.push('Sun el ' + (S.sunMin !== null ? S.sunMin : '') + '…' + (S.sunMax !== null ? S.sunMax : '') + '°');
  if (S.ground) a.push('antenna'); if (satsOn().length) a.push(satsOn().length + ' relay' + (satsOn().length > 1 ? 's' : '')); if (S.needD) a.push(S.needD + ' d of Sun');
  $('limSum').textContent = a.join(' · ');
  $('perSum').textContent = fmtDay(S.startMs) + ' – ' + fmtDay(S.startMs + (S.spanD - 1) * DAY) + ' · stats ' + S.horizonD + ' d';
  $('fLim').innerHTML = limitsList().map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');
}
/* Pinned scenarios: a counter in the bar that opens them. */
function updatePinCount() {
  var n = S.pins.filter(function (p) { return SITES.indexOf(p.site) >= 0; }).length;
  $('pinCount').hidden = !n; $('pinN').textContent = n;
}
$('pinCount').addEventListener('click', function () { setView('list'); setTab('compare'); $('sec-an').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
/* Section links under the hero and in Compare. Buttons, not anchors: the URL hash holds the page state. */
Array.prototype.forEach.call(document.querySelectorAll('.subnav button'), function (b) {
  b.addEventListener('click', function () {
    var t = b.getAttribute('data-tab'); if (t) setTab(t);
    $(b.getAttribute('data-sec')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
if (window.IntersectionObserver) {
  var secSeen = {};
  var secObs = new IntersectionObserver(function (en) {
    en.forEach(function (x) { secSeen[x.target.id] = x.isIntersecting ? x.intersectionRatio : 0; });
    Array.prototype.forEach.call(document.querySelectorAll('.subnav'), function (nav) {
      var best = null, bv = 0;
      Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { var v = secSeen[b.getAttribute('data-sec')] || 0; if (v > bv) { bv = v; best = b.getAttribute('data-sec'); } });
      Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
        var on = b.getAttribute('data-sec') === best && (!b.getAttribute('data-tab') || b.getAttribute('data-tab') === S.tab);
        b.setAttribute('aria-current', on ? 'true' : 'false');
      });
    });
  }, { rootMargin: '-100px 0px -45% 0px', threshold: [0, 0.1, 0.3, 0.6, 1] });
  ['sec-now', 'sec-slip', 'sec-skyline', 'sec-maps', 'sec-chart', 'sec-unc', 'sec-export', 'sec-table', 'sec-year', 'sec-an'].forEach(function (id) { secObs.observe($(id)); });
}
function redrawAll() {
  refreshData(true); kick();
  if (S.view === 'find') { drawFmap(); drawLp(); }
}
function setTheme(t) {
  t = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t); $('themeBtn').textContent = t === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('lwb.theme', t); } catch (x) {}
  readColors();
}
$('themeBtn').addEventListener('click', function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); redrawAll(); });

/* ================= animation loop ================= */
var rafOn = false, lastT = 0;
function kick() { if (!rafOn) { rafOn = true; lastT = performance.now(); requestAnimationFrame(loop); } }
function loop(now) {
  var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (S.playing) {
    S.tMs += S.speed * 3600000 * dt;
    var end = S.startMs + spanSteps() * STEP_MS - STEP_MS;
    if (S.tMs >= end) { S.tMs = end; setPlaying(false); }
    updateTime(); refreshData(false);
  }
  if (anim) anim(now);
  renderSky();
  if (S.playing || anim) requestAnimationFrame(loop); else rafOn = false;
}
function setPlaying(on) { S.playing = on; $('play').textContent = on ? 'Pause' : 'Play'; if (on) kick(); else refreshData(true); }
$('play').addEventListener('click', function () { setPlaying(!S.playing); });
$('speed').addEventListener('change', function () { S.speed = +$('speed').value; });
var settle = null;
function scrubbed() { updateTime(); refreshData(false); kick(); clearTimeout(settle); settle = setTimeout(function () { refreshData(true); }, 250); }
$('t').addEventListener('input', function () { S.tMs = S.startMs + (+$('t').value) * 60000; scrubbed(); });
function scrubFrom(cv, e, geomL, geomW) {
  var r = cv.getBoundingClientRect(), x = clamp(e.clientX - r.left - geomL, 0, geomW), n = spanSteps();
  S.tMs = S.startMs + Math.round(x / geomW * (n - 1)) * STEP_MS; scrubbed();
}
function bindScrub(cv, geomFn) {
  var down = false;
  cv.addEventListener('pointerdown', function (e) { down = true; try { cv.setPointerCapture(e.pointerId); } catch (x) {} var g = geomFn(); scrubFrom(cv, e, g[0], g[1]); });
  cv.addEventListener('pointermove', function (e) { if (down) { var g = geomFn(); scrubFrom(cv, e, g[0], g[1]); } });
  cv.addEventListener('pointerup', function () { down = false; }); cv.addEventListener('pointercancel', function () { down = false; });
}
bindScrub($('strip'), function () { return [0, $('strip').clientWidth]; });
bindScrub($('chart'), function () { return chartGeom ? [chartGeom.L, chartGeom.pw] : [0, $('chart').clientWidth]; });
function jump(dir) {
  var s = SITES[S.sel], lim = S.startMs + (spanSteps() - 1) * STEP_MS, w = null;
  if (dir > 0) w = s.wins.filter(function (x) { return x.t0 > S.tMs + 1000 && x.t0 <= lim; })[0];
  else { var before = s.wins.filter(function (x) { return x.t0 < S.tMs - 1000; }); w = before[before.length - 1]; }
  if (!w) return;
  S.tMs = Math.ceil(w.t0 / 60000) * 60000; updateTime(); refreshData(true); kick();
}
$('nextWin').addEventListener('click', function () { jump(1); });
$('prevWin').addEventListener('click', function () { jump(-1); });

/* ================= export and sharing ================= */
function exportData() {
  var s = SITES[S.sel], lim = spanSteps(), wins = windowsIn(s, 0, lim), dialEnd = stepMs(lim - 1), mh = maskHeight(s);
  var d = {
    tool: 'Lunar Window Browser', generated_utc: new Date().toISOString(), not_flight_grade: true,
    site: { name: s.name, lat_deg: +s.lat.toFixed(5), lon_east_deg: +((s.lon + 360) % 360).toFixed(5), frame: 'Moon mean Earth / polar axis (ME)', source: s.custom ? 'user entry' : s.src, source_url: s.url || null, ground_height_m: s.terr ? s.terr.h_m : null },
    assumptions: {
      dial_start_utc: iso(S.startMs), dial_end_utc: iso(dialEnd),
      ephemeris: STEPS.fallback ? 'astronomy-engine fallback, IAU rotation model' : 'SPICE DE440 (de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf), MOON_ME, LT+S, 2 h grid, cubic interpolation',
      terrain: terrLabel(s), terrain_usable: !noTerrainPolar(s), observer_height_m: mh === null ? S.hobs : mh, sun_and_earth: 'finite disks; no atmosphere',
      irradiance: 'W/m2 on a surface facing the Sun: 1361 W/m2 at 1 au (IAU 2015 Resolution B3 nominal total solar irradiance) x (1 au / Sun distance)^2 x visible fraction of a uniform solar disk; no limb darkening, no array model',
      limits: limitsList(),
      ground_antennas: S.ground ? stationsOn().map(function (q) { return q.name + ' (' + q.lat.toFixed(4) + ', ' + q.lon.toFixed(4) + ', ' + Math.round(q.h_m) + ' m, limit ' + q.minEl + ' deg' + (q.builtin ? ', ' + DSN_SRC : ', user entry') + ')'; }) : null,
      relay_satellites: satsOn().length ? satsOn().map(function (q) { return q.name + ': ' + satSummary(q) + '; counts ' + q.minEl + ' deg or more above the skyline; state vector moved two-body (GM 4902.800118 km3/s2, DE440) or interpolated Horizons table; ICRF to body-fixed by the IAU rotation model'; }) : null,
      sampling: '10-min samples; events root-found by bisection to 1 s',
      uncertainty: 'not included in this file; the page shows elevation-model clone ranges where clones exist'
    },
    windows_meeting_limits: wins.map(function (w) { return { opens_utc: iso(w.t0), closes_utc: iso(w.t1), still_open_at_end_of_range: !!w.cut, duration_h: +((w.t1 - w.t0) / 3600000).toFixed(2) }; }),
    sun_events: s.sunEdges.filter(function (e) { return e.t <= dialEnd; }).map(function (e) { return { utc: new Date(e.t).toISOString().slice(0, 19) + 'Z', event: 'Sun (' + sunWord() + ') ' + (e.on ? 'becomes visible' : 'no longer visible') }; }),
    earth_events: s.earthEdges.filter(function (e) { return e.t <= dialEnd; }).map(function (e) { return { utc: new Date(e.t).toISOString().slice(0, 19) + 'Z', event: e.on ? 'Earthrise (centre clears the skyline' + (S.linkMin ? ' by ' + S.linkMin + ' deg' : '') + ')' : 'Earthset' }; }),
    hourly: []
  };
  // hourly Sun/Earth geometry across the dial, for downstream power, thermal and link tools
  for (var i = 0; i < lim; i += 6) d.hourly.push([iso(stepMs(i)), +s.sunAz[i].toFixed(2), +s.sunEl[i].toFixed(3), +s.sunFrac[i].toFixed(3), +s.irr[i].toFixed(1), +s.earthAz[i].toFixed(2), +s.earthEl[i].toFixed(3), +s.earthMar[i].toFixed(3), s.link[i], s.relay[i] >= 0 ? STEPS.comms.sats[s.relay[i]].name.replace(/,/g, ' ') : '', s.open[i]]);
  d.hourly_columns = ['utc', 'sun_az_deg', 'sun_el_deg', 'sun_disk_fraction_visible', 'irradiance_w_m2', 'earth_az_deg', 'earth_el_deg', 'earth_centre_above_skyline_deg', 'link', 'relay_satellite', 'meets_limits'];
  return d;
}
function toCSV(d) {
  var L = ['# Lunar Window Browser export. Not flight-grade.', '# site: ' + d.site.name + ' | lat ' + d.site.lat_deg + ' | lon E ' + d.site.lon_east_deg + ' | ' + d.site.frame, '# source: ' + d.site.source];
  Object.keys(d.assumptions).forEach(function (k) { var v = d.assumptions[k]; L.push('# ' + k + ': ' + (Array.isArray(v) ? v.join('; ') : v)); });
  d.windows_meeting_limits.forEach(function (w) { L.push('# window: ' + w.opens_utc + ' to ' + w.closes_utc + (w.still_open_at_end_of_range ? ' (still open at end of range)' : '') + ', ' + w.duration_h + ' h'); });
  d.sun_events.forEach(function (e) { L.push('# sun event: ' + e.utc + ' ' + e.event); });
  d.earth_events.forEach(function (e) { L.push('# earth event: ' + e.utc + ' ' + e.event); });
  L.push(d.hourly_columns.join(','));
  d.hourly.forEach(function (r) { L.push(r.join(',')); });
  return L.join('\n');
}
function deliver(text, name, mime, btn, label) {
  var out = $('csvOut');
  out.hidden = false; out.value = text;
  try {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    btn.textContent = 'Saved'; setTimeout(function () { btn.textContent = label; }, 2200);
  } catch (x) {}
}
function fileBase() { return 'lunar-windows_' + SITES[S.sel].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '_' + iso(S.startMs).slice(0, 10); }
$('csvBtn').addEventListener('click', function () { deliver(toCSV(exportData()), fileBase() + '.csv', 'text/csv', $('csvBtn'), 'Export CSV'); });
$('jsonBtn').addEventListener('click', function () { deliver(JSON.stringify(exportData(), null, 1), fileBase() + '.json', 'application/json', $('jsonBtn'), 'Export JSON'); });

/* State in the URL hash, so a link reproduces the view:
   s=<site id or lat,lon>  t=<UTC minute>  h=<observer height>  l=<sun fraction;sun min;sun max;link;days;dsn>
   c=<pinned id@time,...> (listed sites only)  v=<find|list>  m=polar
   f=<finder landing date;surface days>  g=<six goals>  a=<area: lat from;lat to;lon from;lon to>  e=<ellipse east;north>. */
var hashReady = false, FIND_IDS = { g: ['gIrr', 'gDay', 'gDark', 'gEarth', 'gOut', 'gSlope'], a: ['fLat0', 'fLat1', 'fLon0', 'fLon1'], e: ['lpA', 'lpB'], f: ['fStart', 'fDays'] };
function siteKey(s) { return s.id || (s.lat.toFixed(4) + ',' + s.lon.toFixed(4)); }
function writeHash() {
  if (!hashReady) return;
  var s = SITES[S.sel], h = 's=' + siteKey(s) + '&t=' + iso(S.tMs) + (S.hobs !== 2 ? '&h=' + S.hobs : '');
  var l = [S.sunFracMin, S.sunMin === null ? '' : S.sunMin, S.sunMax === null ? '' : S.sunMax, S.linkMin, S.needD, S.ground ? 1 : 0].join(';');
  if (l !== '0;;;0;0;0') h += '&l=' + l;
  var pins = S.pins.filter(function (p) { return p.site.id; }).map(function (p) { return p.site.id + '@' + iso(p.tMs); });
  if (pins.length) h += '&c=' + pins.join(',');
  if (S.view !== 'site') h += '&v=' + S.view;
  updatePinCount();
  if (S.skyMode !== 'sky') h += '&m=' + S.skyMode;
  ['g', 'a', 'e'].forEach(function (k) { var v = FIND_IDS[k].map(function (id) { return $(id).value; }).join(';'); if (v.replace(/;/g, '')) h += '&' + k + '=' + v; });
  if (S.view === 'find' && $('fStart').value) h += '&f=' + $('fStart').value + ';' + $('fDays').value;
  try { history.replaceState(null, '', '#' + h); } catch (x) {}
}
function readHash() {
  var q = {}; (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p.slice(1).join('=') || ''); });
  if (q.h === '10') S.hobs = 10;
  if (q.l) {
    var a = q.l.split(';'), num = function (v, d) { var x = parseFloat(v); return isFinite(x) ? x : d; };
    S.sunFracMin = [0, 0.5, 1].indexOf(num(a[0], 0)) >= 0 ? num(a[0], 0) : 0; S.sunMin = num(a[1], null); S.sunMax = num(a[2], null);
    S.linkMin = clamp(num(a[3], 0), 0, 60); S.needD = clamp(num(a[4], 0), 0, 40); S.ground = a[5] === '1';
  }
  if (q.s) {
    var idx = -1; SITES.forEach(function (s, i) { if (s.id === q.s) idx = i; });
    if (idx < 0 && /^-?[\d.]+,-?[\d.]+$/.test(q.s)) {
      var ll = q.s.split(',').map(Number);
      if (Math.abs(ll[0]) <= 90 && Math.abs(ll[1]) <= 360) {
        SITES.forEach(function (s, i) { if (Math.abs(s.lat - ll[0]) < 1e-4 && Math.abs(s.lon - (((ll[1] + 540) % 360) - 180)) < 1e-4) idx = i; });
        if (idx < 0) { SITES.push(makeSite({ name: 'Shared site ' + fmtCoord(ll[0], ((ll[1] + 540) % 360) - 180), lat: ll[0], lon: ll[1] }, true)); idx = SITES.length - 1; }
      }
    }
    if (idx >= 0) S.sel = idx;
  }
  if (q.c) q.c.split(',').slice(0, 4).forEach(function (pc) {
    var p = pc.split('@'), t = Date.parse(p[1]), site = SITES.filter(function (s) { return s.id === p[0]; })[0];
    if (site && isFinite(t)) S.pins.push({ site: site, tMs: t });
  });
  if (q.v === 'find' || q.v === 'list' || q.v === 'method') S.view = q.v;
  if (q.m === 'polar' || q.m === '3d') S.skyMode = q.m;
  ['g', 'a', 'e', 'f'].forEach(function (k) { if (q[k]) q[k].split(';').forEach(function (v, i) { var id = FIND_IDS[k][i]; if (id && (v === '' || /^[-\d.]+$/.test(v))) $(id).value = v; }); });
  var t0 = q.t ? Date.parse(q.t) : NaN;
  return isFinite(t0) ? t0 : null;
}
$('shareBtn').addEventListener('click', function () {
  writeHash();
  var b = $('shareBtn'), url = location.href;
  function done(ok) { b.textContent = ok ? 'Link copied' : 'Link is in the address bar'; setTimeout(function () { b.textContent = 'Copy link'; }, 2200); }
  try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (x) { done(false); }
});
$('pinBtn').addEventListener('click', function () { addPin(); writeHash(); var b = $('pinBtn'); b.textContent = 'Pinned (see Compare)'; setTimeout(function () { b.textContent = 'Pin to compare'; }, 2200); });
$('tolBtn').addEventListener('click', function () { lpForSite(S.sel); });

/* ================= settings ================= */
function syncControls() {
  $('sunFrac').value = String(S.sunFracMin); $('sunMin').value = S.sunMin === null ? '' : S.sunMin; $('sunMax').value = S.sunMax === null ? '' : S.sunMax;
  $('linkMin').value = S.linkMin; $('needD').value = S.needD; $('ground').checked = S.ground; $('hobs').value = String(S.hobs);
  $('optLines').checked = S.opt.lines; $('optNames').checked = S.opt.names; $('optGrid').checked = S.opt.grid;
  var er = LWB.ephRange();
  $('ephNote').textContent = 'SPICE ephemeris covers ' + iso(er[0]).slice(0, 10) + ' to ' + iso(er[1]).slice(0, 10) + '. Other dates (Apollo, for example) use the fallback and are labelled.';
  limSummary();
}
function readLimits() {
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : null; }
  S.sunFracMin = +$('sunFrac').value; S.sunMin = num('sunMin'); S.sunMax = num('sunMax');
  S.linkMin = clamp(num('linkMin') || 0, 0, 60); S.needD = clamp(num('needD') || 0, 0, 40);
}
['sunFrac', 'sunMin', 'sunMax', 'linkMin', 'needD'].forEach(function (id) { $(id).addEventListener('change', function () { readLimits(); recompute(false); refreshAnalysis(); }); });
$('horizon').addEventListener('change', function () { S.horizonD = +$('horizon').value; limSummary(); refreshData(true); refreshAnalysis(); });
$('hobs').addEventListener('change', function () { S.hobs = +$('hobs').value; SITES.forEach(applyHorizon); recompute(true); });
$('ground').addEventListener('change', function () { S.ground = $('ground').checked; recompute(true); });
$('start').addEventListener('change', function () { var v = $('start').value; if (!v) return; var p = v.split('-'); S.startMs = Date.UTC(+p[0], +p[1] - 1, +p[2]); S.tMs = S.startMs; recompute(true); });
$('span').addEventListener('change', function () { S.spanD = +$('span').value; recompute(true); });
['optLines', 'optNames', 'optGrid'].forEach(function (id) { $(id).addEventListener('change', function () { S.opt = { lines: $('optLines').checked, names: $('optNames').checked, grid: $('optGrid').checked }; kick(); }); });
function refreshAnalysis() {
  S.pins.forEach(function (p) { p.key = null; });
  if (S.view === 'list') { if (S.tab === 'compare') drawCompare(); else runPareto(); } else PF.pts = [];
  if (S.view === 'find') findCompute();
}
/* steps true: geometry changed (dial range, observer height, ground stations). false: only the limits. */
function recompute(steps) {
  var busy = $('busy');
  function run() {
    if (steps) { buildSteps(); SITES.forEach(computeSite); } else SITES.forEach(function (q) { if (q.ready) computeOpen(q); });
    $('t').max = (spanSteps() - 1) * STEP_MIN;
    var end = S.startMs + (spanSteps() - 1) * STEP_MS; if (S.tMs > end) S.tMs = end; if (S.tMs < S.startMs) S.tMs = S.startMs;
    limSummary(); renderLook(); updateTime(); refreshData(true); kick(); busy.hidden = true;
    if (steps) refreshAnalysis();
  }
  if (steps) { busy.hidden = false; setTimeout(run, 20); } else run();
}

/* ================= terrain for custom points ================= */
/* The helper (tools/terrain/serve.py) computes a full-resolution mask for any point south of 80 S. It is probed
   when the page is served by it, when the add-site form opens and when a landing-precision grid is asked for;
   never in the background on other hosts. */
var ADD_HINT = 'Type coordinates, paste a list, or pick a spot on a map.';
function helperBase() { return /^https?:$/.test(location.protocol) && location.port === '8791' ? '' : HELPER.url; }
function pingHelper() {
  var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 1500);
  return fetch(helperBase() + '/ping', { signal: ctl.signal }).then(function (r) { return r.json(); }).then(function (j) { HELPER.ok = !!j.ok; }, function () { HELPER.ok = false; })
    .then(function () { clearTimeout(tm); helperText(); return HELPER.ok; });
}
function helperText() {
  var t = HELPER.ok ? 'Terrain helper connected: a custom point south of 80°S gets a full-resolution LOLA skyline, computed on your machine.'
    : 'Custom points get terrain in three cases: a candidate opened from Find a site, a point within 1 km of a listed south-pole site (nearest 100 m grid point), or anywhere south of 80°S when the terrain helper is running (python tools/terrain/serve.py). Otherwise they use a smooth sphere, which is not usable near the pole.';
  $('helperNote').textContent = t; $('addHint').textContent = ADD_HINT + ' ' + t;
}
/* Local east/north offset (m) of a point from a site, tangent-plane. */
function offsetFrom(s, lat, lon) { var u = LWB.unitOf(lat, lon), d = [u[0] - s.geo.u[0], u[1] - s.geo.u[1], u[2] - s.geo.u[2]]; return [dot(d, s.geo.e) * RM * 1000, dot(d, s.geo.n) * RM * 1000]; }
function terrainFor(lat, lon) {
  if (lat > -80.02) return Promise.resolve(null);
  var viaHelper = HELPER.ok ? fetch(helperBase() + '/mask?lat=' + lat + '&lon=' + lon).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || j.error || !j.mask) return null;
    j.from = 'computed on demand by the terrain helper'; return j;
  }, function () { return null; }) : Promise.resolve(null);
  return viaHelper.then(function (rec) {
    if (rec) return rec;
    var M = TERRAIN.meta.grid, half = (M.n - 1) / 2 * M.spacing_m, best = null;
    SITES.forEach(function (q) {
      if (q.custom || !q.terr || !q.terr.grid) return;
      var o = offsetFrom(q, lat, lon);
      if (Math.abs(o[0]) <= half + M.spacing_m / 2 && Math.abs(o[1]) <= half + M.spacing_m / 2 && (!best || Math.hypot(o[0], o[1]) < best.r)) best = { q: q, o: o, r: Math.hypot(o[0], o[1]) };
    });
    if (!best) return null;
    return loadGrid(best.q).then(function (G) {
      if (!G) return null;
      var c = (G.n - 1) / 2, ix = clamp(Math.round(best.o[0] / G.d + c), 0, G.n - 1), iy = clamp(Math.round(best.o[1] / G.d + c), 0, G.n - 1), k = iy * G.n + ix;
      var miss = Math.hypot(best.o[0] - (ix - c) * G.d, best.o[1] - (iy - c) * G.d), mask = {}, slope = {};
      mask[String(G.hobs)] = i16b64(G.masks[k]); slope[best.q.terr.grid.slope_grid.replace(' ', '')] = G.slope[k];
      return { dem: best.q.terr.dem, mask: mask, h_m: G.h[k], slope: slope, from: 'nearest 100 m grid point of ' + best.q.name + ', ' + Math.round(miss) + ' m from your point' };
    });
  });
}

/* ================= add / remove sites ================= */
function setAddOpen(on) { $('addForm').hidden = !on; $('addBtn').setAttribute('aria-expanded', on ? 'true' : 'false'); if (!on) pickMode = false; else { $('newName').focus(); pingHelper(); } }
$('addBtn').addEventListener('click', function () { setAddOpen($('addForm').hidden); });
$('addCancel').addEventListener('click', function () { setAddOpen(false); });
$('pickBtn').addEventListener('click', function () { pickMode = true; setView('site'); $('polar').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
function addOne(name, lat, lon) {
  lon = ((lon + 540) % 360) - 180;
  return terrainFor(lat, lon).then(function (terr) {
    var s = makeSite({ name: name || ('Site at ' + fmtCoord(lat, lon)), lat: lat, lon: lon, terr: terr }, true); computeSite(s); SITES.push(s); return s;
  });
}
function okLL(lat, lon) { return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && lon >= -180 && lon <= 360; }
function afterAdd(n, bad) {
  saveCustom(); renderSiteSel(); helperText();
  $('addHint').textContent = 'Added ' + n + ' site' + (n === 1 ? '' : 's') + (bad ? '; ' + bad + ' line' + (bad === 1 ? ' was' : 's were') + ' not understood (expected: name, latitude, longitude)' : '') + '.';
  selectSite(SITES.length - 1);
}
$('addForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var lat = parseFloat($('newLat').value), lon = parseFloat($('newLon').value);
  if (!okLL(lat, lon)) { $('addHint').textContent = 'Latitude must be between −90 and 90, longitude between −180 and 360 (east positive).'; return; }
  $('addHint').textContent = 'Looking for terrain…';
  addOne(($('newName').value || '').trim(), lat, lon).then(function () { $('newName').value = ''; afterAdd(1, 0); });
});
/* A pasted list: one site per line, "name, latitude, longitude" or "latitude, longitude"; commas, semicolons or tabs. */
$('bulkOk').addEventListener('click', function () {
  var items = [], bad = 0;
  $('bulk').value.split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    var p = line.split(/[,;\t]/).map(function (x) { return x.trim(); }), lat = parseFloat(p[p.length - 2]), lon = parseFloat(p[p.length - 1]);
    if (p.length < 2 || !okLL(lat, lon)) { bad++; return; }
    items.push([p.slice(0, -2).join(', '), lat, lon]);
  });
  if (!items.length) { $('addHint').textContent = bad ? 'No line could be read. Use: name, latitude, longitude (degrees, north and east positive).' : 'Paste at least one line.'; return; }
  items = items.slice(0, 40);
  $('addHint').textContent = 'Looking for terrain for ' + items.length + ' sites…';
  var i = 0;
  (function next() { if (i >= items.length) { $('bulk').value = ''; afterAdd(items.length, bad); return; } var it = items[i++]; addOne(it[0], it[1], it[2]).then(next); })();
});
function removeSiteAt(idx) {
  var s = SITES[idx]; if (!s || !s.custom) return;
  SITES.splice(idx, 1); saveCustom();
  S.sel = S.sel === idx ? 0 : S.sel > idx ? S.sel - 1 : S.sel;
  renderSiteSel(); selectSite(S.sel);
}
$('removeSite').addEventListener('click', function () { removeSiteAt(S.sel); });
function picked(lat, lon) {
  $('newLat').value = lat.toFixed(4); $('newLon').value = lon.toFixed(4); pickMode = false;
  setView('list'); setAddOpen(true);
  $('addHint').textContent = 'Picked ' + fmtCoord(lat, lon) + '. Name it and press Add.'; $('addForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('map').addEventListener('click', function (e) {
  var r = this.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, w = r.width, h = r.height;
  if (pickMode) { picked(90 - y / h * 180, x / w * 360 - 180); return; }
  var best = -1, bd = 18;
  SITES.forEach(function (s, idx) { var dd = Math.hypot((s.lon + 180) / 360 * w - x, (90 - s.lat) / 180 * h - y); if (dd < bd) { bd = dd; best = idx; } });
  if (best >= 0) selectSite(best);
});
$('polar').addEventListener('click', function (e) {
  if (!polarGeom) return;
  var r = this.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = polarGeom;
  if (pickMode) {
    var mx = (x - g.w / 2) / g.sc, my = (g.w / 2 - y) / g.sc, rr = Math.hypot(mx, my);
    picked(2 * Math.atan(rr / PR) * R2D - 90, Math.atan2(mx, my) * R2D); return;
  }
  var best = -1, bd = 16;
  g.pts.forEach(function (p) { var dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p.idx; } });
  if (best >= 0) selectSite(best);
});

var lastW = 0;
if (window.ResizeObserver) {
  new ResizeObserver(function (en) { var w = Math.round(en[0].contentRect.width); if (w === lastW) return; lastW = w; redrawAll(); }).observe(document.body);
  new ResizeObserver(function () { kick(); }).observe(document.querySelector('.hero'));
}

/* ================= boot ================= */
(function () { var t = 'light'; try { t = localStorage.getItem('lwb.theme') || 'light'; } catch (x) {} setTheme(t); })();
buildGrid(); fillObjSelects(); loadComms();
var hashT = readHash();
if (hashT !== null) S.startMs = Math.floor(hashT / DAY) * DAY;
SITES.forEach(applyHorizon);
$('start').value = new Date(S.startMs).toISOString().slice(0, 10);
S.tMs = hashT !== null ? hashT : S.startMs + DAY / 2;
syncControls(); helperText(); renderComms();
// First paint needs only the selected site; the rest are filled in afterwards, a few per frame.
buildSteps(); computeSite(SITES[S.sel]);
$('t').max = (spanSteps() - 1) * STEP_MIN;
renderSiteSel(); renderLook(); updateTime(); defaultView(); setSkyMode(S.skyMode);
(function () { var v = S.view; S.view = ''; setView(v); })();
setBase(BASE);
hashReady = true; writeHash();
window.LWB_BOOT_MS = Math.round(performance.now() - BOOT_T0);
(function fill() {
  var todo = SITES.filter(function (s) { return !s.ready; }).slice(0, 3);
  if (!todo.length) { if (S.view === 'site') { drawMap(); drawPolar(); } else if (S.view === 'list') updateList(); window.LWB_READY_MS = Math.round(performance.now() - BOOT_T0); return; }
  todo.forEach(computeSite); setTimeout(fill, 0);
})();
if (helperBase() === '') pingHelper();
