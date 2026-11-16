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
function sunWord() { return S.sunFracMin >= 1 ? 'whole disk' : S.sunFracMin > 0 ? 'half disk' : 'any part'; }
/* The report panels are plain two-column tables: a heading row per body with its headline on the right. */
function kvH(label, tag, cls) { return '<tr class="h"><th colspan="2">' + label + (tag ? '<span class="tag ' + cls + '">' + tag + '</span>' : '') + '</th></tr>'; }
function kv(k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }
var NOWC = null; // the last headline computation, reused by the uncertainty table
function updateNow() {
  var s = SITES[S.sel], I = nowInfo(s), L = I.L, left = Math.max(1, Math.floor((I.endMs - S.tMs) / DAY)), h = '';
  $('vWhen').textContent = fmtDT(S.tMs);
  if (noTerrainPolar(s)) {
    $('vNow').innerHTML = kvH('No terrain model for this point', '', ''); $('vStats').innerHTML = ''; $('vStatsH').textContent = 'Statistics';
    NOWC = null; showUncertainty(null); return;
  }
  // Sun: time to the next change at the chosen threshold, to the minute
  var setW = S.sunFracMin > 0 ? 'Sun below ' + sunWord() : 'Sunset', riseW = S.sunFracMin > 0 ? 'Sun back to ' + sunWord() : 'Sunrise';
  var bigS, bigE, thr = S.sunFracMin > 0;
  if (I.sunUp) bigS = I.sunNext ? setW + ' in ' + fmtSpan(I.sunNext.t - S.tMs) : (thr ? 'At ' + sunWord() + ' or more for ' + left + ' days' : 'No sunset in ' + left + ' days');
  else bigS = I.sunNext ? riseW + ' in ' + fmtSpan(I.sunNext.t - S.tMs) : (thr ? 'Below ' + sunWord() + ' for ' + left + ' days' : 'No sunrise in ' + left + ' days');
  h += kvH('Sun', bigS, I.sunUp ? 'c-sun' : 'c-off');
  h += kv('Elevation / azimuth', deg2(L.sunEl) + ' / ' + L.sunAz.toFixed(1) + '°');
  h += kv('Disk visible', pct(L.sunFrac));
  h += kv('Irradiance', wm2(L.irr));
  if (I.sunNext) h += kv(I.sunUp ? setW : riseW, fmtDT(I.sunNext.t));
  // Earth: time to loss or return of the line of sight at the chosen margin
  var far = L.earthEl < -15 && !I.earthNext;
  if (I.earthUp) bigE = I.earthNext ? 'Earthset in ' + fmtSpan(I.earthNext.t - S.tMs) : 'In view throughout';
  else bigE = far ? 'Never in view (far side)' : I.earthNext ? 'Earthrise in ' + fmtSpan(I.earthNext.t - S.tMs) : 'No Earthrise in ' + left + ' days';
  h += kvH('Earth', bigE, I.earthUp ? 'c-earth' : 'c-off');
  h += kv('Elevation / azimuth', deg2(L.earthEl) + ' / ' + L.earthAz.toFixed(1) + '°');
  h += kv('Centre above the skyline', deg2(L.earthMargin));
  if (I.earthNext) h += kv(I.earthUp ? 'Earthset' : 'Earthrise', fmtDT(I.earthNext.t));
  // satellites: look angles now and the pass in progress or the next one, to the second
  satsShown().forEach(function (q) {
    var t = satLook(s, q, S.tMs, false), nx = satNext(s, q, S.tMs);
    var tag = !t ? 'No position at this time' : nx.up ? (nx.t ? 'Sets in ' + fmtSpanS(nx.t - S.tMs) : 'In view') : (nx.t ? 'Rises in ' + fmtSpanS(nx.t - S.tMs) : 'Not in view');
    h += kvH(esc(q.name) + (q.relay ? ' (relay)' : ''), tag, t && nx.up ? 'c-sat' : 'c-off');
    if (t) { h += kv('Elevation / azimuth', deg2(t.el) + ' / ' + t.az.toFixed(1) + '°'); h += kv('Range', km(t.range) + ' km'); }
    var cd = satCadence(s, q);
    if (cd.n) {
      h += kv('Revisit (timeline)', cd.revisit ? 'every ' + fmtSpanS(cd.revisit) + ' avg, longest wait ' + fmtSpanS(cd.gapMax) : cd.n + ' pass');
      if (cd.durAvg) h += kv('Pass length', fmtSpanS(cd.durAvg) + ' avg (' + fmtSpanS(cd.durMin) + ' to ' + fmtSpanS(cd.durMax) + ')');
      h += kv('In view', pct(cd.share) + ' of the timeline, ' + cd.n + ' passes');
    } else h += kv('Passes', 'none above the skyline in the timeline');
    var age = satAgeText(q); if (age) h += kv('Orbit state', age);
  });
  $('vNow').innerHTML = h;
  var P = periodStats(s, stepOf(S.tMs)), days = Math.round(P.days), sum = s.lastSum;
  $('vStatsH').textContent = 'Next ' + days + ' days';
  var st = kv('Mean irradiance', '<span class="big">' + wm2(P.irrAvg) + '</span>') + kv('Lowest 24 h mean', wm2(P.irrDayMin)) + kv('Sun in view', pct(P.litFrac)) + kv('Longest darkness', fmtHours(P.darkMaxH)) +
    kv(linkWord(), pct(P.earthFrac)) + kv('Longest link outage', fmtHours(P.outMaxH)) +
    kv('Constraints met', sum ? fmtDur(sum.openSteps) + ' (' + Math.round(sum.openSteps / Math.max(1, sum.H) * 100) + '%)' : '');
  if (slopeText(s) !== 'n/a') st += kv('Slope (LOLA grid)', slopeText(s));
  $('vStats').innerHTML = st;
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
/* The plain-language part: how far the ground height and the skyline could be off here, and what that does to the
   next sunrise or sunset and to the share of time in sunlight. Same clone data as the table; no new numbers. */
function uncCards(s, u) {
  var cards = [], what = '', c = s.terr && !s.custom && s.id && CLONES.sites[s.id], Q = c && s.clones && s.clones[maskHeight(s)], p = Q && Q.spread;
  function card(t, big, sub) { cards.push('<div><span>' + t + '</span><b class="big">' + big + '</b><span>' + sub + '</span></div>'); }
  if (!s.terr) what = 'There is no terrain model for this point, so the page has nothing to say about how sure it is.';
  else if (!c) what = '<b>Not measured for this point.</b> The LOLA team publishes error models only for its 5 m maps of selected south-pole sites; ' + (s.terr.dem[0] !== '5 m' ? 'this skyline comes from the ' + esc(s.terr.dem[0]) + ' map.' : 'this point is not one of them.') + ' The page does not guess a number.';
  else if (!p) what = c.mask[String(maskHeight(s))] ? 'Reading the error models…' : 'Error models were run for 2 m and 10 m observers only, so there is no measured spread at ' + S.hobs + ' m.';
  else {
    var sunW = LWB.look(s.geo, S.tMs).sunRad * 2;
    card('Ground height', '±' + p.hSd.toFixed(1) + ' m', 'one standard deviation across ' + p.n + ' error models of the LOLA map');
    card('Skyline edge, typical', '±' + p.rms.toFixed(2) + '°', 'averaged all the way round; the Sun is ' + sunW.toFixed(2) + '° wide, so this is ' + Math.round(p.rms / sunW * 100) + '% of its width');
    card('Skyline edge, worst direction', '±' + p.worst.toFixed(2) + '°', 'toward ' + compass16(p.worstAz) + ' (' + Math.round(p.worstAz) + '°)');
    if (u && u.clones && NOWC) {
      var C = u.clones, I = NOWC.I, ts = C.sunEdge.filter(function (t) { return t !== null; });
      if (ts.length && (C.sunUp === C.n || C.sunUp === 0)) { var r = rangeOf(ts); card(I.sunUp ? 'Next sunset could shift by' : 'Next sunrise could shift by', r[1] - r[0] < 60000 ? 'under 1 min' : fmtSpan(r[1] - r[0]), 'earliest ' + fmtDT(r[0]) + ', latest ' + fmtDT(r[1])); }
      else if (C.sunUp !== C.n && C.sunUp !== 0) card('Is the Sun up right now?', C.sunUp + ' of ' + C.n + ' say yes', 'the Sun is grazing the skyline, so the terrain error decides it');
      var a = rangeOf(C.lit); card('Sun in view, next ' + Math.round(NOWC.P.days) + ' days', pct(a[0]) + ' to ' + pct(a[1]), 'this model: ' + pct(NOWC.P.litFrac));
    }
    what = 'NASA\'s LOLA team re-drew this 5 m map ' + p.n + ' times with its known measurement and interpolation errors (Barker et al. 2021, PGDA error clones). The spread between those versions is how sure the map is. Only terrain inside the 5 m tile varies between them; the distant skyline is the same in all, so these figures are a lower bound on the true uncertainty. ' + learn('lola', 'How LOLA measures height');
  }
  $('uCards').innerHTML = cards.join(''); $('uWhat').innerHTML = what;
}
function showUncertainty(u) {
  var s = SITES[S.sel], head = $('uHead'), tb = $('uTable');
  $('vTerrUnc').textContent = terrUnc(s);
  uncCards(s, u);
  if (!NOWC || NOWC.s !== s) { tb.innerHTML = ''; return; }
  if (!s.terr) { head.textContent = 'No terrain model here, so terrain uncertainty is not quantified.'; tb.innerHTML = ''; return; }
  var hasClones = !s.custom && s.id && CLONES.sites[s.id];
  if (!u) { head.textContent = hasClones || s.terr.grid ? 'Recomputed on the error models when the time rests…' : 'Elevation-model error is not quantified for this point: PGDA error clones (Barker et al. 2021) exist only for its 5 m site models.'; tb.innerHTML = ''; return; }
  var C = u.clones, I = NOWC.I, P = NOWC.P, rows = [];
  head.textContent = C ? 'How far the LOLA terrain could be off at this site, and what that changes. (Specialist table below: each number recomputed on ' + C.n + ' error-clone elevation models; the range is elevation-model error only, not a confidence interval.)'
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
  if (!c.mask[String(maskHeight(s))]) return 'Clone skylines exist for 2 m and 10 m observers only.';
  if (!Q || !Q.spread) return 'Reading ' + c.n + ' LOLA error clones…';
  var p = Q.spread;
  return 'Skyline scatter across ' + p.n + ' LOLA error-clone models (1σ): ' + p.rms.toFixed(3) + '° RMS over all azimuths, ' + p.worst.toFixed(2) + '° at the worst azimuth (' + Math.round(p.worstAz) + '°). Ground height ±' + p.hSd.toFixed(2) + ' m (1σ). This is near-field elevation-model error only; the far field is the same in every clone.';
}
function updateVerdict() {
  var s = SITES[S.sel], r = summarize(s, stepOf(S.tMs)), bad = noTerrainPolar(s);
  s.lastSum = r;
  var el = $('vState'); el.textContent = bad ? 'No terrain' : r.openNow ? 'Constraints met' : 'Constraints not met'; el.className = 'vstate' + (r.openNow && !bad ? ' on' : '');
  var cat = (CATS.filter(function (c) { return c[0] === s.cat; })[0] || ['', ''])[1];
  $('vCoord').innerHTML = '<b>' + fmtCoord(s.lat, s.lon) + '</b>' + (s.terr ? ' · <span title="LOLA ground height above the 1737.4 km reference sphere (the LOLA datum), not above a mean surface">ground ' + Math.round(s.terr.h_m).toLocaleString('en-US') + ' m above the 1737.4 km sphere</span>' : '') + (cat ? ' · ' + cat : '');
  $('removeSite').hidden = !s.custom;
  var vr = $('vReason'); vr.textContent = bad ? 'No terrain model for this point: nothing is reported.' : r.text; vr.className = 'msg ' + (bad ? 'stop' : r.openNow ? 'pick' : 'warn');
  var badge = $('vBadge');
  if (bad) { badge.hidden = false; badge.className = 'msg stop'; badge.textContent = 'No terrain for this point. Near the pole the Sun and Earth sit within a few degrees of the horizon, so a smooth sphere is not usable. Pick a point within 1 km of a listed south-pole site, take a candidate from the Site finder, or run the terrain helper (python tools/terrain/serve.py) and add the point again.'; }
  else if (s.terr && s.terr.dem.length === 1) { badge.hidden = false; badge.className = 'msg warn'; badge.textContent = 'Horizon from the 240 m LOLA grid only: regional relief is included, nearby relief smaller than 240 m is not. Where the two could be compared, a 240 m horizon changed the sunlit share by up to 52 points.'; }
  else if (!s.terr && Math.abs(s.lat) >= 60) { badge.hidden = false; badge.className = 'msg warn'; badge.textContent = 'High-latitude site without a terrain mask: real terrain can block the low Sun and Earth here. Treat these numbers as approximate.'; }
  else if (s.terr && maskHeight(s) !== S.hobs) { badge.hidden = false; badge.className = 'msg info'; badge.textContent = 'This point has no ' + S.hobs + ' m skyline, so the ' + maskHeight(s) + ' m one is used. Exact skylines at every height exist for the listed south-pole sites.'; }
  else badge.hidden = true;
  var fb = $('vFallback'); fb.hidden = !STEPS.fallback;
  if (STEPS.fallback) { var er = LWB.ephRange(); fb.textContent = 'Fallback ephemeris in use: part of this period lies outside the precomputed SPICE span (' + iso(er[0]).slice(0, 10) + ' to ' + iso(er[1]).slice(0, 10) + '). Positions come from astronomy-engine with the IAU rotation model (checked to 0.003° against Horizons instead of 0.00002°).'; }
  // windows in the statistics period
  var tzl = tzLabel(S.tMs), wh = '<tr><th>Opens (' + tzl + ')</th><th>Closes (' + tzl + ')</th><th>Duration</th></tr>';
  if (bad || !r.wins.length) wh += '<tr><td colspan="3" class="mu" style="text-align:left">' + (bad ? 'Not computed.' : 'None in the next ' + S.horizonD + ' days.') + '</td></tr>';
  else r.wins.forEach(function (w) { wh += '<tr data-t="' + Math.ceil(w.t0 / 60000) * 60000 + '" title="Go to the start of this window"><td>' + fmtDay(w.t0) + ', ' + fmtClock(w.t0) + '</td><td>' + fmtDay(w.t1) + ', ' + fmtClock(w.t1) + (w.cut ? ' +' : '') + '</td><td>' + fmtSpan(w.t1 - w.t0) + '</td></tr>'; });
  $('vWins').innerHTML = wh;
  // the model tab: what the numbers above assume
  var mh = maskHeight(s), rows = [];
  rows.push(['Constraints', limitsList().join('; ')]);
  rows.push(['Terrain', terrLabel(s) + ', observer ' + (mh === null ? S.hobs : mh) + ' m above ' + (s.terr ? 'the ground' : 'the sphere') + (s.terr && mh !== S.hobs ? ' (no ' + S.hobs + ' m mask for this point, so the nearest, ' + mh + ' m, is used)' : '')]);
  rows.push(['Ephemeris', STEPS.fallback ? 'astronomy-engine fallback (IAU frame)' : 'SPICE DE440, MOON_ME, apparent (LT+S)']);
  rows.push(['Sun and Earth', 'Finite disks, no atmosphere; events root-found to 1 s from 10-min samples']);
  rows.push(['Irradiance', '1361 W/m² at 1 au × (1 au / Sun distance)² × visible disk fraction, on a Sun-facing surface']);
  if (s.terr) {
    rows.push(['Ground height', s.terr.h_m.toFixed(0) + ' m above the 1737.4 km reference sphere (LOLA datum). The observer height is added on top of this.']);
    rows.push(['Skyline', deg2(s.geo.hMin) + ' to ' + deg2(s.geo.hMax) + (s.terr.stats ? ', farthest horizon point ' + s.terr.stats.max_dist_km + ' km (at 2 m)' : '')]);
    var sl = []; if (s.terr.slope && s.terr.slope['5m'] !== undefined) sl.push(s.terr.slope['5m'].toFixed(1) + '° over 10 m'); if (s.terr.slope && s.terr.slope['20m'] !== undefined) sl.push(s.terr.slope['20m'].toFixed(1) + '° over 40 m');
    if (sl.length) rows.push(['Slope (LOLA grid, B-spline gradient)', sl.join(', ') + '. Not a lander-scale slope.']);
  }
  satsShown().forEach(function (q) { rows.push(['Satellite: ' + esc(q.name), esc(satSummary(q)) + (q.relay ? '; relay, counts ' + (q.minEl ? q.minEl + '° or more' : 'anywhere') + ' above the skyline' : '; shown only')]); });
  if (satsShown().some(function (q) { return q.kind === 'num' && !q.twoBody; })) rows.push(['Orbit propagation', esc(propModelText())]);
  $('vWhy').innerHTML = rows.map(function (rw) { return '<tr><th>' + rw[0] + '</th><td style="white-space:normal;text-align:left">' + rw[1] + '</td></tr>'; }).join('');
  if (s.terr && !s.custom && s.id && CLONES.sites[s.id] && !(s.clones && s.clones[maskHeight(s)])) loadClones(s).then(function () { var tu = $('vTerrUnc'); if (tu && SITES[S.sel] === s) { tu.textContent = terrUnc(s); uncCards(s, null); } });
  $('vSrc').innerHTML = s.custom ? 'Custom site: coordinates as entered.' + (s.terr ? ' Terrain: ' + esc(terrLabel(s)) + '.' : '') :
    'Coordinates (ME frame): ' + esc(s.src) + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">source</a>' : '') + (s.note ? '<br>' + esc(s.note) : '');
  $('skyNote').textContent = s.geo.mask ? 'Skyline from LOLA terrain. Drag to look around.' : 'Smooth sphere, no terrain. Drag to look around.';
  $('sbEph').innerHTML = 'Ephemeris: <b>' + (STEPS.fallback ? 'astronomy-engine (fallback)' : 'JPL DE440 (SPICE)') + '</b>';
  $('sbTerr').innerHTML = 'Terrain: <b>' + esc(s.terr ? 'LOLA ' + s.terr.dem.join(' + ') : 'none (sphere)') + '</b>, observer ' + (mh === null ? S.hobs : mh) + ' m';
  updateNow();
}
$('vWins').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-t]'); if (tr) gotoTime(+tr.getAttribute('data-t')); });
function updateTime() {
  $('t').value = Math.round((S.tMs - S.startMs) / 60000);
  $('tLabel').textContent = fmtFull(S.tMs);
  $('clock').innerHTML = 'Scenario time <b>' + fmtFull(S.tMs) + '</b>' + (S.tz === 'local' ? ' <span title="UTC">(' + iso(S.tMs).slice(11, 16) + ' UTC)</span>' : '');
  if (document.activeElement !== $('tTime')) $('tTime').value = toZonedInput(S.tMs);
}
/* Type a time (UTC, or the observer's local time): a time outside the period moves the period (gotoTime). */
function typedTime() {
  var ms = parseZoned($('tTime').value); if (!isFinite(ms)) return;
  if (S.playing) setPlaying(false);
  if (Math.abs(ms - S.tMs) >= 60000) gotoTime(ms);
}
$('tTime').addEventListener('change', typedTime);
$('tTime').addEventListener('keydown', function (e) { if (e.key === 'Enter') { typedTime(); this.blur(); } });
/* UTC or the Earth observer's local time, for every clock time on the page (files stay in UTC). */
function setTz(z) {
  S.tz = z === 'local' ? 'local' : 'utc'; TZC = {};
  try { localStorage.setItem('lwb.tz.v1', S.tz); } catch (x) {}
  Array.prototype.forEach.call(document.querySelectorAll('#tzSeg button, #feTz button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tz') === S.tz ? 'true' : 'false'); });
  Array.prototype.forEach.call(document.querySelectorAll('.tzName'), function (el) { el.textContent = S.tz === 'local' ? tzLabel(S.tMs) + ', ' + tzZone() : 'UTC'; });
  $('start').value = toZonedInput(S.startMs);
  if (!STEPS) return;
  limSummary(); updateTime(); refreshData(true); kick();
  if (S.view === 'list') updateList();
}
document.addEventListener('click', function (e) { var b = e.target.closest('[data-tz]'); if (b && b.closest('#tzSeg, #feTz')) setTz(b.getAttribute('data-tz')); });
/* Arrow keys step the time by one second of play at the chosen speed (Shift: ten), unless a control has focus. */
document.addEventListener('keydown', function (e) {
  if (S.view !== 'site' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
  var a = document.activeElement, tag = a && a.tagName;
  if (a && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || a.id === 'sky' || a.id === 'sky3d' || a.id === 'skyEarth' || a.isContentEditable)) return;
  e.preventDefault();
  if (S.playing) setPlaying(false);
  var step = Math.max(60000, Math.round(S.speed * 3600000 / 60000) * 60000) * (e.shiftKey ? 10 : 1);
  gotoTime(S.tMs + (e.key === 'ArrowRight' ? step : -step));
});
/* Only what is showing is drawn: a hidden canvas has no size. Switching view or tab redraws it. */
var lastStep = -1, lastMapDraw = 0, lastNow = 0, lastHz = 0, lastStrip = 0;
function drawAtab(force, now) {
  if (S.atab === 'skyline') { if (force || now - lastHz > 120) { lastHz = now; drawHorizon(); } if (force) horizonNote(); }
  else if (S.atab === 'maps') { if (force || now - lastMapDraw > 250) { lastMapDraw = now; drawMap(); drawPolar(); } }
  else if (S.atab === 'slip') { if (force) slipCompute(); }
  else if (S.atab === 'unc') { if (force) scheduleUncertainty(); }
}
function refreshData(force) {
  var i0 = stepOf(S.tMs), now = performance.now();
  if (S.view === 'site') {
    if (force || i0 !== lastStep) {
      lastStep = i0;
      if (force || !S.playing || now - lastNow > 200) { lastNow = now; updateVerdict(); }
    }
    if (force || now - lastStrip > 80) { lastStrip = now; drawStrip(); }
    drawAtab(force, now);
  } else if (force && S.view === 'list') updateList();
  if (force) writeHash();
}
function setAtab(k) {
  S.atab = k;
  Array.prototype.forEach.call(document.querySelectorAll('#atabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-atab') === k ? 'true' : 'false'); });
  Array.prototype.forEach.call(document.querySelectorAll('.lower > [data-atab]'), function (d) { d.hidden = d.getAttribute('data-atab') !== k; });
  if (S.view === 'site' && STEPS) drawAtab(true, performance.now());
}
$('atabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-atab]'); if (b) setAtab(b.getAttribute('data-atab')); });
function selectSite(idx) {
  if (idx < 0 || idx >= SITES.length) return;
  if (!SITES[idx].ready) computeSite(SITES[idx]);
  S.sel = idx; $('siteSel').value = String(idx); defaultView(); renderLook(); renderComms(); refreshData(true); kick();
}
/* Go to a time, moving the period's start if the time is outside it. */
function gotoTime(ms) {
  if (ms < S.startMs || ms > S.startMs + (spanSteps() - 1) * STEP_MS) {
    S.startMs = Math.floor(ms / DAY) * DAY; $('start').value = toZonedInput(S.startMs);
    S.tMs = ms; ensureProp(); buildSteps(); SITES.forEach(computeSite); $('t').max = (spanSteps() - 1) * STEP_MIN;
  }
  S.tMs = ms; limSummary(); updateTime(); refreshData(true); kick();
}

/* ================= views ================= */
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
  else { refreshData(true); if (v === 'site') kick(); }
}
Array.prototype.forEach.call(document.querySelectorAll('.views button'), function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
document.addEventListener('click', function (e) { var b = e.target.closest('[data-goto]'); if (b) setView(b.getAttribute('data-goto')); });
/* The constraints live in the Site view; the finder shows them and links back. */
function limSummary() {
  var pe = S.startMs + S.spanD * DAY;
  $('perSum').textContent = fmtDT(S.startMs).replace(/ \S+$/, '') + ' to ' + fmtDT(pe).replace(/ \S+$/, '') + ' ' + new Date(shiftTz(pe)).getUTCFullYear() + ', ' + tzLabel(S.startMs) + ' (' + S.spanD + ' days)';
  if ($('fLim')) $('fLim').innerHTML = limitsList().map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');
}
function redrawAll() {
  refreshData(true); kick();
  if (S.view === 'find') drawFmap();
}
$('optGrid').addEventListener('click', function () { S.opt.grid = !S.opt.grid; this.setAttribute('aria-pressed', S.opt.grid ? 'true' : 'false'); kick(); });

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
bindScrub($('strip'), function () { return [TL.left || TL.L, TL.pw || $('strip').clientWidth]; });
/* Window buttons: go to the start of the next / previous window, compared at the minute the page jumps to (the
   window's start rounded up), so going back after going forward does not land on the same window. Outside the
   timeline the period moves (gotoTime); with no window in the computed range the bar says so. */
var winMsgT = 0;
function winStart(w) { return Math.ceil(w.t0 / 60000) * 60000; }
function jump(dir) {
  var s = SITES[S.sel], w = null, msg = $('winMsg');
  if (S.playing) setPlaying(false);
  if (noTerrainPolar(s)) { msg.textContent = 'No terrain here, so no windows are computed.'; return; }
  if (dir > 0) w = s.wins.filter(function (x) { return winStart(x) > S.tMs; })[0];
  else {
    var prevOf = function () { var before = s.wins.filter(function (x) { return winStart(x) < S.tMs; }); return before[before.length - 1]; };
    w = prevOf();
    // none left in the computed range: move the period back one span and look again
    if (!w || winStart(w) < S.startMs) {
      var keep = S.tMs; S.startMs -= S.spanD * DAY; $('start').value = toZonedInput(S.startMs);
      ensureProp(); buildSteps(); SITES.forEach(computeSite); $('t').max = (spanSteps() - 1) * STEP_MIN; S.tMs = keep;
      w = prevOf();
    }
  }
  clearTimeout(winMsgT);
  if (!w) { msg.textContent = dir > 0 ? 'No later window in the ' + Math.round((stepMs(S.N - 1) - S.startMs) / DAY) + ' days computed.' : 'No earlier window since the period start.'; winMsgT = setTimeout(function () { msg.textContent = ''; }, 3500); return; }
  msg.textContent = 'Window ' + (s.wins.indexOf(w) + 1) + ' of ' + s.wins.length + ', ' + fmtSpan(w.t1 - w.t0) + (w.cut ? ' or more' : '');
  winMsgT = setTimeout(function () { msg.textContent = ''; }, 3500);
  gotoTime(winStart(w));
}
$('nextWin').addEventListener('click', function () { jump(1); });
$('prevWin').addEventListener('click', function () { jump(-1); });

/* ================= export and sharing ================= */
function exportData() {
  var s = SITES[S.sel], lim = spanSteps(), wins = windowsIn(s, 0, lim), dialEnd = stepMs(lim - 1), mh = maskHeight(s);
  var d = {
    tool: 'LILO (Lunar Illumination and Landing Optimizer)', generated_utc: new Date().toISOString(), not_flight_grade: true,
    site: { name: s.name, lat_deg: +s.lat.toFixed(5), lon_east_deg: +((s.lon + 360) % 360).toFixed(5), frame: 'Moon mean Earth / polar axis (ME)', source: s.custom ? 'user entry' : s.src, source_url: s.url || null, ground_height_m: s.terr ? s.terr.h_m : null },
    assumptions: {
      period_start_utc: iso(S.startMs), period_end_utc: iso(dialEnd),
      ephemeris: STEPS.fallback ? 'astronomy-engine fallback, IAU rotation model' : 'SPICE DE440 (de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf), MOON_ME, LT+S, 2 h grid, cubic interpolation',
      terrain: terrLabel(s), terrain_usable: !noTerrainPolar(s), observer_height_m: mh === null ? S.hobs : mh, sun_and_earth: 'finite disks; no atmosphere',
      irradiance: 'W/m2 on a surface facing the Sun: 1361 W/m2 at 1 au (IAU 2015 Resolution B3 nominal total solar irradiance) x (1 au / Sun distance)^2 x visible fraction of a uniform solar disk; no limb darkening, no array model',
      limits: limitsList(),
      ground_antennas: S.ground ? stationsOn().map(function (q) { return q.name + ' (' + q.lat.toFixed(4) + ', ' + q.lon.toFixed(4) + ', ' + Math.round(q.h_m) + ' m, limit ' + q.minEl + ' deg' + (q.builtin ? ', ' + DSN_SRC : ', user entry') + ')'; }) : null,
      relay_satellites: satsOn().length ? satsOn().map(function (q) { return q.name + ': ' + satSummary(q) + '; counts ' + q.minEl + ' deg or more above the skyline; ICRF to body-fixed by the IAU rotation model'; }) : null,
      orbit_propagation: satsOn().some(function (q) { return q.kind === 'num' && !q.twoBody; }) ? propModelText() : null,
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
  var L = ['# LILO (Lunar Illumination and Landing Optimizer) export. Not flight-grade.', '# site: ' + d.site.name + ' | lat ' + d.site.lat_deg + ' | lon E ' + d.site.lon_east_deg + ' | ' + d.site.frame, '# source: ' + d.site.source];
  Object.keys(d.assumptions).forEach(function (k) { var v = d.assumptions[k]; L.push('# ' + k + ': ' + (Array.isArray(v) ? v.join('; ') : v)); });
  d.windows_meeting_limits.forEach(function (w) { L.push('# window: ' + w.opens_utc + ' to ' + w.closes_utc + (w.still_open_at_end_of_range ? ' (still open at end of range)' : '') + ', ' + w.duration_h + ' h'); });
  d.sun_events.forEach(function (e) { L.push('# sun event: ' + e.utc + ' ' + e.event); });
  d.earth_events.forEach(function (e) { L.push('# earth event: ' + e.utc + ' ' + e.event); });
  L.push(d.hourly_columns.join(','));
  d.hourly.forEach(function (r) { L.push(r.join(',')); });
  return L.join('\n');
}
function deliver(text, name, mime, btn, label) {
  window.LWB_LAST_EXPORT = text;
  try {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    btn.textContent = 'Saved'; setTimeout(function () { btn.textContent = label; }, 2200);
  } catch (x) {}
}
function fileBase() { return 'lunar-windows_' + SITES[S.sel].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '_' + iso(S.startMs).slice(0, 10); }
$('csvBtn').addEventListener('click', function () { deliver(toCSV(exportData()), fileBase() + '.csv', 'text/csv', $('csvBtn'), 'Export CSV'); });

/* State in the URL hash, so a link reproduces the view:
   s=<site id or lat,lon>  t=<UTC minute>  h=<observer height>  l=<sun fraction;sun min;;link;;stations>
   v=<find|list|method>  m=<polar|3d>  p=<analysis tab>
   f=<finder landing date;surface days>  g=<six goals>  a=<area: lat from;lat to;lon from;lon to>.
   Satellites and stations are saved in the browser, not in the link. */
var hashReady = false, FIND_IDS = { a: ['fLat0', 'fLat1', 'fLon0', 'fLon1'], f: ['fStart', 'fDays'] };
var ATABS = ['skyline', 'slip', 'maps', 'unc', 'model'];
function siteKey(s) { return s.id || (s.lat.toFixed(4) + ',' + s.lon.toFixed(4)); }
function writeHash() {
  if (!hashReady) return;
  var s = SITES[S.sel], h = 's=' + siteKey(s) + '&t=' + iso(S.tMs) + (S.hobs !== 2 ? '&h=' + S.hobs : '') + (S.spanD !== 30 ? '&d=' + S.spanD : '');
  var l = [S.sunFracMin, S.sunMin === null ? '' : S.sunMin, '', S.linkMin, 0, S.ground ? 1 : 0].join(';');
  if (l !== '0;;;0;0;0') h += '&l=' + l;
  if (S.view !== 'site') h += '&v=' + S.view;
  if (S.skyMode !== 'sky') h += '&m=' + S.skyMode;
  if (S.atab !== 'skyline') h += '&p=' + S.atab;
  ['a'].forEach(function (k) { var v = FIND_IDS[k].map(function (id) { return $(id).value; }).join(';'); if (v.replace(/;/g, '') && v !== AREA0.join(';')) h += '&' + k + '=' + v; });
  var gh = FIND.dom.sol ? gHash() : FIND.hashG; if (gh) h += '&g=' + gh;
  if (S.view === 'find' && $('fStart').value) h += '&f=' + $('fStart').value + ';' + $('fDays').value;
  try { history.replaceState(null, '', '#' + h); } catch (x) {}
}
function readHash() {
  var q = {}; (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv2) { var p = kv2.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p.slice(1).join('=') || ''); });
  if (q.h && HOBS_OPTS.indexOf(+q.h) >= 0) S.hobs = +q.h;
  if (q.d && isFinite(+q.d)) S.spanD = clamp(Math.round(+q.d), 1, 365);
  if (q.tz === 'local') S.tz = 'local';
  if (q.track === 'earth' || q.track === 'sun') S.track = q.track;
  if (q.l) {
    var a = q.l.split(';'), num = function (v, d) { var x = parseFloat(v); return isFinite(x) ? x : d; };
    S.sunFracMin = [0, 0.5, 1].indexOf(num(a[0], 0)) >= 0 ? num(a[0], 0) : 0; S.sunMin = num(a[1], null);
    S.linkMin = clamp(num(a[3], 0), 0, 60); S.ground = a[5] === '1';
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
  if (q.v === 'find' || q.v === 'list' || q.v === 'method') S.view = q.v;
  if (q.m === 'polar' || q.m === '3d' || q.m === 'earth') S.skyMode = q.m;
  if (ATABS.indexOf(q.p) >= 0) S.atab = q.p;
  if (q.g && /^[a-z:.,\d-]+$/.test(q.g)) FIND.hashG = q.g;
  ['a', 'f'].forEach(function (k) { if (q[k]) q[k].split(';').forEach(function (v, i) { var id = FIND_IDS[k][i]; if (id && (v === '' || /^[-\d.]+$/.test(v))) $(id).value = v; }); });
  var t0 = q.t ? Date.parse(q.t) : NaN;
  return isFinite(t0) ? t0 : null;
}
$('shareBtn').addEventListener('click', function () {
  writeHash();
  var b = $('shareBtn'), url = location.href;
  function done(ok) { b.textContent = ok ? 'Link copied' : 'Link is in the address bar'; setTimeout(function () { b.textContent = 'Copy link'; }, 2200); }
  try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (x) { done(false); }
});

/* ================= settings ================= */
function syncControls() {
  $('sunFrac').value = String(S.sunFracMin); $('sunMin').value = S.sunMin === null ? '' : S.sunMin;
  $('linkMin').value = S.linkMin; $('ground').checked = S.ground; syncHobs(); syncSpan();
  $('optGrid').setAttribute('aria-pressed', S.opt.grid ? 'true' : 'false');
  var er = LWB.ephRange();
  $('ephNote').textContent = 'SPICE ephemeris: ' + iso(er[0]).slice(0, 10) + ' to ' + iso(er[1]).slice(0, 10) + '. Other dates use a labelled fallback.';
  limSummary();
}
function readLimits() {
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : null; }
  S.sunFracMin = +$('sunFrac').value; S.sunMin = num('sunMin');
  S.linkMin = clamp(num('linkMin') || 0, 0, 60);
}
['sunFrac', 'sunMin', 'linkMin'].forEach(function (id) { $(id).addEventListener('change', function () { readLimits(); recompute(false); refreshAnalysis(); }); });
$('horizon').addEventListener('change', function () { S.horizonD = +$('horizon').value; limSummary(); refreshData(true); refreshAnalysis(); });
/* Observer height: one of HOBS_OPTS, each with its own exact LOLA mask. */
function setHobs(h) { if (HOBS_OPTS.indexOf(h) < 0 || h === S.hobs) return; S.hobs = h; SITES.forEach(applyHorizon); syncHobs(); recompute(true); }
function syncHobs() { $('hobs').value = String(S.hobs); }
$('hobs').addEventListener('change', function () { setHobs(+this.value); });
$('ground').addEventListener('change', function () { S.ground = $('ground').checked; recompute(true); });
/* Start: a date and time (UTC, or local when the clock is local); the period may start at any minute. */
$('start').addEventListener('change', function () { var ms = parseZoned($('start').value); if (!isFinite(ms)) return; S.startMs = Math.round(ms / 60000) * 60000; S.tMs = S.startMs; recompute(true); });
/* Length: one of the presets or a custom number of days, 1 to 365. */
function setSpan(d) { d = clamp(Math.round(d), 1, 365); if (d === S.spanD) return; S.spanD = d; syncSpan(); recompute(true); }
function syncSpan() {
  var pre = [3, 14, 30, 60, 120].indexOf(S.spanD) >= 0;
  if (document.activeElement !== $('span')) $('span').value = pre ? String(S.spanD) : 'custom';
  $('spanCWrap').hidden = $('span').value !== 'custom'; if (!pre) $('spanC').value = S.spanD;
}
$('span').addEventListener('change', function () { if (this.value === 'custom') { $('spanCWrap').hidden = false; $('spanC').focus(); setSpan(+$('spanC').value || 45); } else setSpan(+this.value); });
$('spanC').addEventListener('change', function () { var v = parseFloat(this.value); if (isFinite(v)) setSpan(v); this.value = S.spanD; });
function refreshAnalysis() { if (S.view === 'find') findCompute(); }
/* steps true: geometry changed (period, observer height, stations, relays). false: only the constraints. */
function recompute(steps) {
  var busy = $('busy');
  function run() {
    if (steps) { ensureProp(); buildSteps(); SITES.forEach(computeSite); } else SITES.forEach(function (q) { if (q.ready) computeOpen(q); });
    $('t').max = (spanSteps() - 1) * STEP_MIN;
    var end = S.startMs + (spanSteps() - 1) * STEP_MS; if (S.tMs > end) S.tMs = end; if (S.tMs < S.startMs) S.tMs = S.startMs;
    limSummary(); renderLook(); renderComms(); updateTime(); refreshData(true); kick(); busy.hidden = true;
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
  var t = HELPER.ok ? 'Terrain helper connected: a point south of 80°S gets a full-resolution LOLA skyline, computed on your machine.'
    : 'A custom point gets terrain when it lies within 1 km of a listed south-pole site (nearest 100 m grid point), when it is opened from the Site finder, or anywhere south of 80°S while the terrain helper runs (python tools/terrain/serve.py). Otherwise it uses a smooth sphere, which is not usable near the pole.';
  $('addHint').textContent = ADD_HINT + ' ' + t;
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
function setAddOpen(on) { $('addForm').hidden = !on; $('addBtn').setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) { $('newName').focus(); pingHelper(); } }
$('addBtn').addEventListener('click', function () { setAddOpen($('addForm').hidden); });
$('addCancel').addEventListener('click', function () { setAddOpen(false); });
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
/* A click on either map opens the nearest site. */
$('map').addEventListener('click', function (e) {
  var r = this.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, w = r.width, h = r.height;
  var best = -1, bd = 18;
  SITES.forEach(function (s, idx) { var dd = Math.hypot((s.lon + 180) / 360 * w - x, (90 - s.lat) / 180 * h - y); if (dd < bd) { bd = dd; best = idx; } });
  if (best >= 0) selectSite(best);
});
$('polar').addEventListener('click', function (e) {
  if (!polarGeom) return;
  var r = this.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = 16;
  polarGeom.pts.forEach(function (p) { var dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p.idx; } });
  if (best >= 0) selectSite(best);
});

var lastW = 0;
if (window.ResizeObserver) {
  new ResizeObserver(function (en) { var w = Math.round(en[0].contentRect.width); if (w === lastW) return; lastW = w; redrawAll(); }).observe(document.body);
  new ResizeObserver(function () { kick(); }).observe(document.querySelector('.hero'));
}

/* ================= boot ================= */
readColors();
buildGrid(); loadComms();
var hashT = readHash();
if (hashT !== null) S.startMs = Math.floor(hashT / DAY) * DAY;
SITES.forEach(applyHorizon);
$('start').value = toZonedInput(S.startMs);
S.tMs = hashT !== null ? hashT : S.startMs + DAY / 2;
syncControls(); helperText(); renderComms(); renderMethod();
$('mLearn').innerHTML = Object.keys(LEARN).map(function (k) { var L = LEARN[k]; return '<li><b>' + esc(L[0]) + '</b>: <a href="' + L[2] + '" target="_blank" rel="noopener">' + esc(L[1]) + '</a></li>'; }).join('');
$('gsLearn').innerHTML = learn('dsn', 'Deep Space Network') + ' ' + learn('dsnbasics', 'How DSN links work');
setTz(S.tz);
// On a phone the scenario panels start closed, so the view comes right after the site.
if (window.innerWidth < 900) ['pTime', 'pLim', 'pSat'].forEach(function (id) { $(id).open = false; });
// First paint needs only the selected site; the rest are filled in afterwards, a few per frame.
buildSteps(); computeSite(SITES[S.sel]);
$('t').max = (spanSteps() - 1) * STEP_MIN;
renderSiteSel(); renderLook(); updateTime(); defaultView(); setSkyMode(S.skyMode); setAtab(S.atab);
(function () { var v = S.view; S.view = ''; setView(v); })();
setBase(BASE);
hashReady = true; writeHash();
window.LWB_BOOT_MS = Math.round(performance.now() - BOOT_T0);
(function fill() {
  var todo = SITES.filter(function (s) { return !s.ready; }).slice(0, 3);
  if (!todo.length) { if (S.view === 'site') drawAtab(true, performance.now()); else if (S.view === 'list') updateList(); window.LWB_READY_MS = Math.round(performance.now() - BOOT_T0); ensureProp(); return; }
  todo.forEach(computeSite); setTimeout(fill, 0);
})();
if (helperBase() === '') pingHelper();
