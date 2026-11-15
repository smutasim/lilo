/* ================= step precompute ================= */
function buildSteps() {
  var N = (S.spanD + EXTRA_D) * PER_DAY;
  S.N = N;
  var T = { sun: new Float64Array(N * 3), earth: new Float64Array(N * 3), fallback: false };
  var d = LWB.newDirs();
  for (var i = 0; i < N; i++) {
    var ms = stepMs(i);
    LWB.dirs(ms, d);
    T.sun[i*3] = d.sun[0]; T.sun[i*3+1] = d.sun[1]; T.sun[i*3+2] = d.sun[2];
    T.earth[i*3] = d.earth[0]; T.earth[i*3+1] = d.earth[1]; T.earth[i*3+2] = d.earth[2];
    if (d.src !== 'spice') T.fallback = true;
  }
  // ground antennas (sampled every DSN_EVERY steps and held) and relay satellites
  T.comms = commsSeries(N, stepMs, T.earth, DSN_EVERY);
  T.dsnMoon = T.comms.moon;
  STEPS = T;
}
/* Geometry that depends only on the site, its horizon and the dial: Sun and Earth direction, visible fraction
   of the solar disk, and Earth's height above the local skyline. */
function computeGeom(s) {
  var N = S.N, T = STEPS, g = s.geo, v = [0, 0, 0], t = {};
  s.sunEl = new Float32Array(N); s.sunAz = new Float32Array(N); s.sunFrac = new Float32Array(N); s.irr = new Float32Array(N);
  s.earthEl = new Float32Array(N); s.earthAz = new Float32Array(N); s.earthMar = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    v[0] = T.sun[i*3]; v[1] = T.sun[i*3+1]; v[2] = T.sun[i*3+2];
    LWB.topo(g, v, t);
    s.sunEl[i] = t.el; s.sunAz[i] = t.az; s.sunFrac[i] = LWB.diskFrac(g, t.az, t.el, Math.asin(LWB.R_SUN / t.range) * R2D);
    s.irr[i] = LWB.irradiance(s.sunFrac[i], t.range);
    v[0] = T.earth[i*3]; v[1] = T.earth[i*3+1]; v[2] = T.earth[i*3+2];
    LWB.topo(g, v, t);
    s.earthEl[i] = t.el; s.earthAz[i] = t.az; s.earthMar[i] = t.el - LWB.horizonAt(g, t.az);
  }
  // relay: index of the first satellite that gives a link at each step, -1 for none
  var C = T.comms; s.relay = new Int8Array(N).fill(-1);
  if (C && C.k) for (i = 0; i < N; i++) for (var k = 0; k < C.k; k++) {
    var o = i * C.k + k; if (!C.ok[o]) continue;
    v[0] = C.pos[o*3]; v[1] = C.pos[o*3+1]; v[2] = C.pos[o*3+2];
    LWB.topo(g, v, t);
    if (t.el - LWB.horizonAt(g, t.az) >= C.minEl[k]) { s.relay[i] = k; break; }
  }
}
function directAt(i, mar) { return mar >= S.linkMin && STEPS.dsnMoon[i]; }
/* Step-grid transitions of a flag, each refined to 1 s by bisection on the continuous predicate. */
function edgesFrom(flagAt, pred) {
  var out = [], prev = flagAt(0);
  for (var i = 1; i < S.N; i++) {
    var cur = flagAt(i);
    if (cur !== prev) { out.push({ t: LWB.refine(pred, stepMs(i - 1), stepMs(i), 1000), on: cur }); prev = cur; }
  }
  return out;
}
function nextEdge(edges, ms, on) {
  for (var k = 0; k < edges.length; k++) if (edges[k].t > ms && (on === undefined || edges[k].on === on)) return edges[k];
  return null;
}
function elOK(el) { return (S.sunMin === null || el >= S.sunMin) && (S.sunMax === null || el <= S.sunMax); }
/* Limit-dependent part: Sun and Earth events at the chosen thresholds, and the windows that meet every limit. */
function computeOpen(s) {
  var N = S.N, T = STEPS, g = s.geo, q;
  s.link = new Uint8Array(N); s.open = new Uint8Array(N); s.run = new Uint16Array(N);
  var r = 0;
  for (q = N - 1; q >= 0; q--) { r = sunOK(s.sunFrac[q]) ? Math.min(65535, r + 1) : 0; s.run[q] = r; }
  var need = S.needD * PER_DAY;
  for (q = 0; q < N; q++) {
    s.link[q] = (directAt(q, s.earthMar[q]) || s.relay[q] >= 0) ? 1 : 0;
    s.open[q] = (sunOK(s.sunFrac[q]) && elOK(s.sunEl[q]) && s.link[q] && s.run[q] >= need) ? 1 : 0;
  }
  s.sunEdges = edgesFrom(function (i) { return sunOK(s.sunFrac[i]); }, function (ms) { return sunOK(LWB.sunFracAt(g, ms)); });
  s.earthEdges = edgesFrom(function (i) { return s.earthMar[i] >= S.linkMin; }, function (ms) { return LWB.earthMarginAt(g, ms) >= S.linkMin; });
  s.wins = []; var cur = -1;
  for (q = 0; q < N; q++) {
    var o = s.open[q];
    if (o && cur < 0) cur = q;
    if ((!o || q === N - 1) && cur >= 0) { s.wins.push({ s: cur, e: o ? q : q - 1 }); cur = -1; }
  }
  var pred = function (ms) { return openAt(s, ms); };
  s.wins.forEach(function (w) {
    w.len = w.e - w.s + 1;
    w.t0 = w.s > 0 ? LWB.refine(pred, stepMs(w.s - 1), stepMs(w.s), 1000) : stepMs(w.s);
    w.t1 = w.e < N - 1 ? LWB.refine(pred, stepMs(w.e), stepMs(w.e + 1), 1000) : stepMs(w.e);
    w.cut = w.e >= N - 1;     // still open where the computed range ends
  });
  s.unc = null;
}
function computeSite(s) { computeGeom(s); computeOpen(s); s.ready = true; }
/* The limits test at an arbitrary instant. Sun and Earth terms are continuous; ground-station visibility comes
   from the nearest 30-min sample; remaining sunlight uses the root-found sunset. */
function openAt(s, ms) {
  var o = LWB.look(s.geo, ms);
  if (!sunOK(o.sunFrac) || !elOK(o.sunEl)) return false;
  var i = stepOf(ms);
  if (!directAt(i, o.earthMargin) && relayAt(s, ms, i) < 0) return false;
  if (!S.needD) return true;
  var set = nextEdge(s.sunEdges, ms, false);
  return (set ? set.t : stepMs(S.N - 1)) - ms >= S.needD * DAY;
}
/* Windows that overlap steps [a, b), clipped to that range. */
function windowsIn(s, a, b) {
  var out = [];
  s.wins.forEach(function (w) {
    if (w.e < a || w.s >= b) return;
    if (w.s >= a && w.e < b) { out.push(w); return; }
    var c = { s: Math.max(w.s, a), e: Math.min(w.e, b - 1) };
    c.len = c.e - c.s + 1; c.t0 = w.s >= a ? w.t0 : stepMs(a); c.t1 = w.e < b ? w.t1 : stepMs(b - 1); c.cut = w.e >= b;
    out.push(c);
  });
  return out;
}
/* Lighting and link statistics over the scored period, from the step arrays. "Sunlit" is any part of the Sun
   visible, the definition used for average illumination in Mazarico et al. 2011. */
function periodStats(s, i0) {
  var end = Math.min(S.N, i0 + S.horizonD * PER_DAY), n = end - i0, sum = 0, lit = 0, earth = 0, run = 0, dark = 0, isum = 0, out = 0, outMax = 0;
  var w = PER_DAY, acc = 0, dayMin = Infinity;
  for (var i = i0; i < end; i++) {
    var f = s.sunFrac[i]; sum += f; isum += s.irr[i];
    acc += s.irr[i]; if (i - i0 >= w) acc -= s.irr[i - w]; if (i - i0 >= w - 1 && acc / w < dayMin) dayMin = acc / w;
    if (f > 0) { lit++; run = 0; } else { run++; if (run > dark) dark = run; }
    if (s.link[i]) { earth++; out = 0; } else { out++; if (out > outMax) outMax = out; }
  }
  if (!isFinite(dayMin)) dayMin = isum / n;
  return { sunAvg: sum / n, litFrac: lit / n, earthFrac: earth / n, darkMaxH: dark * STEP_MIN / 60, days: n / PER_DAY,
           irrAvg: isum / n, irrDayMin: Math.max(0, dayMin), outMaxH: outMax * STEP_MIN / 60 };
}
/* The limits in words, for the page and the exports. */
function limitsList() {
  var a = [S.sunFracMin >= 1 ? 'whole Sun visible' : S.sunFracMin > 0 ? 'at least ' + Math.round(S.sunFracMin * 100) + '% of the Sun visible' : 'any part of the Sun visible'];
  if (S.sunMin !== null || S.sunMax !== null) a.push('Sun elevation ' + (S.sunMin !== null ? 'from ' + S.sunMin + '°' : '') + (S.sunMax !== null ? ' up to ' + S.sunMax + '°' : ''));
  a.push('Earth centre ' + (S.linkMin ? S.linkMin + '° or more above' : 'above') + ' the local skyline');
  commsText().forEach(function (t) { a.push(t); });
  if (S.needD) a.push(S.needD + ' days of unbroken sunlight to follow');
  return a;
}
/* What is true now, which limit fails if any, and when the limits are next all met. No rating: the page
   reports quantities and leaves the judgement to the user's own limits. */
function summarize(s, i0) {
  var end = Math.min(S.N, i0 + S.horizonD * PER_DAY), wins = windowsIn(s, i0, end), openSteps = 0;
  wins.forEach(function (w) { openSteps += w.len; });
  var res = { wins: wins, openSteps: openSteps, H: end - i0, openNow: false };
  var L = LWB.look(s.geo, S.tMs), fails = [];
  if (!sunOK(L.sunFrac)) fails.push(L.sunFrac > 0 ? 'only ' + pct(L.sunFrac) + ' of the Sun is visible' : 'the Sun is hidden');
  else if (!elOK(L.sunEl)) fails.push('the Sun is at ' + deg2(L.sunEl) + ', outside the allowed range');
  var relayNow = relayAt(s, S.tMs, i0) >= 0, nSat = satsOn().length;
  if (!relayNow) {
    var why = '';
    if (!(L.earthMargin >= S.linkMin)) why = L.earthMargin < 0 ? 'Earth is below the skyline' : 'Earth is only ' + deg2(L.earthMargin) + ' above the skyline';
    else if (!STEPS.dsnMoon[i0]) why = stationsOn().length ? 'no ticked ground antenna has the Moon above its elevation limit' : 'a ground antenna is required but none is ticked';
    if (why) fails.push(why + (nSat ? ' and no relay satellite gives a link' : ''));
  }
  if (!fails.length && S.needD && !s.open[i0]) fails.push('fewer than ' + S.needD + ' days of unbroken sunlight remain');
  var cur = s.wins.filter(function (w) { return w.t0 <= S.tMs && w.t1 >= S.tMs; })[0];
  if (!fails.length && cur) {
    res.openNow = true;
    res.text = 'All constraints are met, ' + (cur.cut ? 'through the end of the computed range (' + fmtSpan(cur.t1 - S.tMs) + ' or more).' : 'for another ' + fmtSpan(cur.t1 - S.tMs) + ' (until ' + fmtDT(cur.t1) + ').');
  } else {
    var nx = s.wins.filter(function (w) { return w.t0 > S.tMs; })[0];
    res.text = 'Not met: ' + (fails.join(', and ') || 'a constraint fails') + '. ' +
      (nx ? 'Next met ' + fmtDT(nx.t0) + ' (in ' + fmtSpan(nx.t0 - S.tMs) + '), for ' + fmtSpan(nx.t1 - nx.t0) + (nx.cut ? ' or more' : '') + '.'
          : 'Not met again in the ' + Math.floor((stepMs(S.N - 1) - S.tMs) / DAY) + ' days computed.');
  }
  return res;
}
/* Time to the next Sun event and Earth-link change from the dial time, to the minute. */
function nowInfo(s) {
  var L = LWB.look(s.geo, S.tMs), endMs = stepMs(S.N - 1);
  return { L: L, sunUp: sunOK(L.sunFrac), sunNext: nextEdge(s.sunEdges, S.tMs), earthUp: L.earthMargin >= S.linkMin, earthNext: nextEdge(s.earthEdges, S.tMs), endMs: endMs };
}

/* ================= uncertainty of the headline numbers ================= */
/* DEM error: PGDA publishes clones of each 5 m site LDEM with orbital and interpolation errors re-drawn
   (Barker et al. 2021). data/clones.json holds the horizon recomputed on the first N of them. The spread of a
   quantity across the clones is reported as a min-max range with N stated; it is not a confidence interval. */
function loadClones(s) {
  var c = s.id && !s.custom && CLONES.sites[s.id];
  if (!c) return Promise.resolve(null);
  if (!s.clones) s.clones = {};
  var h = maskHeight(s);
  if (s.clones[h]) return Promise.resolve(s.clones[h]);
  if (!c.mask[String(h)]) return Promise.resolve(null);
  return gunzipB64(c.mask[String(h)]).then(function (bytes) {
    if (!bytes) return null;
    var masks = LWB.decodeMasks(bytes, c.n, c.nb);
    s.clones[h] = masks.map(function (m, k) { return LWB.makeSite(s.lat, s.lon, c.h_m[k] + h, m, h); });
    s.clones[h].spread = horizonSpread(masks, c.h_m);
    return s.clones[h];
  });
}
/* Terrain uncertainty at this point, stated directly: how far the clone skylines scatter. Per azimuth bin the
   standard deviation across the clones; reported as the RMS over azimuth and the worst azimuth, with the spread
   of the ground height. Elevation-model error only (Barker et al. 2021 clones), near field only. */
function horizonSpread(masks, hs) {
  var n = masks.length, nb = masks[0].length, sum2 = 0, worst = 0, worstAz = 0;
  for (var k = 0; k < nb; k++) {
    var m = 0, v = 0, j;
    for (j = 0; j < n; j++) m += masks[j][k];
    m /= n;
    for (j = 0; j < n; j++) v += (masks[j][k] - m) * (masks[j][k] - m);
    v = Math.sqrt(v / (n - 1)) / 100; sum2 += v * v;
    if (v > worst) { worst = v; worstAz = k / nb * 360; }
  }
  var hm = 0, hv = 0; hs.forEach(function (x) { hm += x; }); hm /= n; hs.forEach(function (x) { hv += (x - hm) * (x - hm); });
  return { n: n, rms: Math.sqrt(sum2 / nb), worst: worst, worstAz: worstAz, hSd: Math.sqrt(hv / (n - 1)) };
}
function rangeOf(a) { var lo = Infinity, hi = -Infinity; a.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; }); return [lo, hi]; }
/* The page's headline numbers recomputed on each clone horizon. Events are bracketed on a 30-min grid from the
   dial time to the end of the computed range and bisected to 1 s, as for the nominal horizon. */
function cloneStats(s, Q) {
  var ser = LWB.series(S.tMs, S.horizonD, 60), endMs = stepMs(S.N - 1), out = { n: Q.length, lit: [], sun: [], earth: [], irr: [], sunUp: 0, earthUp: 0, sunEdge: [], earthEdge: [] };
  Q.forEach(function (q) {
    var m = LWB.metricsFrom(q, ser, S.linkMin);
    out.lit.push(m.litFrac); out.sun.push(m.sunAvg); out.earth.push(m.earthFrac); out.irr.push(m.irrAvg);
    var ps = function (ms) { return sunOK(LWB.sunFracAt(q, ms)); }, pe = function (ms) { return LWB.earthMarginAt(q, ms) >= S.linkMin; };
    if (ps(S.tMs)) out.sunUp++; if (pe(S.tMs)) out.earthUp++;
    var e1 = LWB.findEdges(ps, S.tMs, endMs, 1800000, 1000)[0], e2 = LWB.findEdges(pe, S.tMs, endMs, 1800000, 1000)[0];
    out.sunEdge.push(e1 ? e1.t : null); out.earthEdge.push(e2 ? e2.t : null);
  });
  return out;
}
/* Position sensitivity: the same statistics at the eight grid nodes 100 m around the listed point. */
function neighbourStats(s, G) {
  var ser = LWB.series(S.tMs, S.horizonD, 60), c = (G.n - 1) / 2, lit = [], sun = [];
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    var k = (c + dy) * G.n + (c + dx), ll = LWB.offsetLatLon(s.lat, s.lon, dx * G.d, dy * G.d);
    var m = LWB.metricsFrom(LWB.makeSite(ll.lat, ll.lon, G.h[k] + G.hobs, G.masks[k], G.hobs), ser, S.linkMin);
    lit.push(m.litFrac); sun.push(m.sunAvg);
  }
  return { lit: rangeOf(lit), sun: rangeOf(sun), d: G.d, hobs: G.hobs };
}
/* Computed when the dial rests (not while playing); cached per site, time, period and limits. */
function uncertainty(s, done) {
  var key = [Math.round(S.tMs / 60000), S.horizonD, S.hobs, S.sunFracMin, S.linkMin, S.N, S.startMs].join(':');
  if (s.unc && s.unc.key === key) { done(s.unc); return; }
  var u = { key: key, clones: null, near: null };
  loadClones(s).then(function (Q) {
    if (Q) u.clones = cloneStats(s, Q);
    return s.terr && s.terr.grid ? loadGrid(s) : null;
  }).then(function (G) {
    if (G) u.near = neighbourStats(s, G);
    s.unc = u; done(u);
  });
}
