/* ================= side-by-side comparison and Pareto trade-offs ================= */
function pinCol(r) { return [C2['--ink'], C2['--relay'], C2['--go'], C2['--stop']][r]; }
function slopeText(s) { var t = s.terr; if (!t || !t.slope) return 'n/a'; return t.slope['5m'] !== undefined ? t.slope['5m'].toFixed(1) + '°' : t.slope['20m'] !== undefined ? t.slope['20m'].toFixed(1) + '°' : 'n/a'; }
function slopeVal(s) { var t = s.terr; if (!t || !t.slope) return NaN; return t.slope['5m'] !== undefined ? t.slope['5m'] : t.slope['20m'] !== undefined ? t.slope['20m'] : NaN; }

/* ---------- compare ---------- */
/* One pinned scenario evaluated on its own 30-min grid, independent of the dial range. */
function evalPin(p) {
  var key = [S.horizonD, S.linkMin, S.hobs, commsKey()].join(':');
  if (p.key === key) return p;
  var g = p.site.geo, stepMin = 30, n = S.horizonD * 48 + 1, d = LWB.newDirs(), t = {};
  var ser = LWB.series(p.tMs, S.horizonD, stepMin), cm = commsFor(ser), gate = cm && cm.gate, relay = cm && cm.relay;
  p.key = key; p.n = n; p.frac = new Float32Array(n); p.earth = new Uint8Array(n);
  var sum = 0, lit = 0, earth = 0, run = 0, dark = 0, isum = 0;
  for (var i = 0; i < n; i++) {
    var ms = p.tMs + i * stepMin * 60000;
    d.sun[0] = ser.sun[i*3]; d.sun[1] = ser.sun[i*3+1]; d.sun[2] = ser.sun[i*3+2]; d.earth[0] = ser.earth[i*3]; d.earth[1] = ser.earth[i*3+1]; d.earth[2] = ser.earth[i*3+2];
    LWB.topo(g, d.sun, t);
    var f = LWB.diskFrac(g, t.az, t.el, Math.asin(LWB.R_SUN / t.range) * R2D);
    if (i === 0) { p.sunEl0 = t.el; }
    p.frac[i] = f; sum += f; isum += LWB.irradiance(f, t.range);
    if (f > 0) { lit++; run = 0; } else { run++; if (run > dark) dark = run; }
    LWB.topo(g, d.earth, t);
    if ((t.el - LWB.horizonAt(g, t.az) >= S.linkMin && (!gate || gate[i])) || (relay && LWB.relayLink(g, relay, i, t))) { p.earth[i] = 1; earth++; }
  }
  p.irrAvg = isum / n; p.sunAvg = sum / n; p.litFrac = lit / n; p.earthFrac = earth / n; p.darkMaxH = dark * 0.5;
  // first change of Sun state and of Earth link after the pinned time, to the minute
  var endMs = p.tMs + S.horizonD * DAY;
  var se = LWB.findEdges(function (ms2) { return LWB.sunFracAt(g, ms2) > 0; }, p.tMs, endMs, 600000, 1000)[0];
  var ee = LWB.findEdges(function (ms2) { return LWB.earthMarginAt(g, ms2) >= S.linkMin; }, p.tMs, endMs, 600000, 1000)[0];
  p.sunUp = p.frac[0] > 0; p.sunEdge = se ? se.t : null; p.earthUp = p.earth[0] === 1; p.earthEdge = ee ? ee.t : null;
  return p;
}
function addPin() {
  var s = SITES[S.sel];
  if (S.pins.some(function (p) { return p.site === s && Math.abs(p.tMs - S.tMs) < 60000; })) return;
  if (S.pins.length >= 4) S.pins.shift();
  S.pins.push({ site: s, tMs: S.tMs });
  setTab('compare'); drawCompare();
}
function wm2(v) { return Math.round(v).toLocaleString('en-US') + ' W/m²'; }
function drawCompare() {
  var cv = $('cmpStrip'), tb = $('cmpTable');
  S.pins = S.pins.filter(function (p) { return SITES.indexOf(p.site) >= 0; });
  updatePinCount();
  if (!S.pins.length) {
    cv.style.height = '0px'; cv.height = 0;
    tb.innerHTML = '<tr><td style="text-align:left;color:var(--mute)">Nothing pinned yet. Open a site at a time of interest and press Pin to compare, or use Pin in the table above. Try the same site on two dates, or two sites on one date.</td></tr>';
    return;
  }
  S.pins.forEach(evalPin);
  var rowH = 34, h = S.pins.length * rowH + 22;
  cv.style.height = h + 'px';
  var F = fit(cv, h), c = F.c, w = F.w, L = 7, pw = w - 11;
  c.font = '10px "IBM Plex Mono", monospace';
  S.pins.forEach(function (p, r) {
    var y = r * rowH + 2;
    c.fillStyle = pinCol(r); c.fillRect(0, y, 3, 25);
    c.fillStyle = C2['--track']; c.fillRect(L, y, pw, 18); c.fillStyle = C2['--track2']; c.fillRect(L, y + 20, pw, 5);
    for (var x = 0; x < pw; x++) {
      var a = Math.floor(x / pw * p.n), b = Math.max(a + 1, Math.floor((x + 1) / pw * p.n)), mf = 0, ek = 0;
      for (var i = a; i < b && i < p.n; i++) { if (p.frac[i] > mf) mf = p.frac[i]; if (p.earth[i]) ek = 1; }
      if (mf > 0) { c.fillStyle = 'rgba(' + C2.sunRGB + ',' + (0.2 + 0.8 * mf).toFixed(2) + ')'; c.fillRect(L + x, y, 1, 18); }
      if (ek) { c.fillStyle = C2['--earth']; c.fillRect(L + x, y + 20, 1, 5); }
    }
  });
  c.fillStyle = C2['--mute']; c.textBaseline = 'top'; c.textAlign = 'left';
  var stepD = S.horizonD <= 7 ? 1 : S.horizonD <= 14 ? 2 : 5;
  for (var d = 0; d <= S.horizonD; d += stepD) { var tx = L + d / S.horizonD * pw; c.fillStyle = C2['--line']; c.fillRect(Math.min(tx, L + pw - 1), S.pins.length * rowH - 4, 1, 5); c.fillStyle = C2['--mute']; if (d < S.horizonD) c.fillText('+' + d + ' d', tx + 3, S.pins.length * rowH + 2); }
  // table
  var cols = [
    ['Mean irradiance', function (p) { return p.irrAvg; }, wm2, 1],
    ['Sunlit time', function (p) { return p.litFrac; }, pct, 1],
    ['Mean Sun visible', function (p) { return p.sunAvg; }, pct, 1],
    [linkWord(), function (p) { return p.earthFrac; }, pct, 1],
    ['Longest dark', function (p) { return p.darkMaxH; }, fmtHours, -1],
    ['Sun at start', function (p) { return p.sunEl0; }, deg2, 0],
    ['Slope', function (p) { return slopeVal(p.site); }, function (v) { return isNaN(v) ? 'n/a' : v.toFixed(1) + '°'; }, -1]
  ];
  var html = '<tr><th>Scenario (next ' + S.horizonD + ' d)</th>' + cols.map(function (cl) { return '<th>' + cl[0] + '</th>'; }).join('') + '<th>Next Sun change</th><th>Next change in direct Earth view</th><th></th></tr>';
  S.pins.forEach(function (p, r) {
    html += '<tr><td><span class="swatch" style="background:' + pinCol(r) + '"></span>' + esc(p.site.name) + '<br><span style="color:var(--mute)">' + iso(p.tMs) + ' · terrain ' + (p.site.geo.mask ? 'yes' : 'no') + '</span></td>';
    cols.forEach(function (cl) {
      var v = cl[1](p), best = cl[3] !== 0 && S.pins.length > 1 && !isNaN(v) && S.pins.every(function (q) { var u = cl[1](q); return isNaN(u) || (cl[3] > 0 ? v >= u : v <= u); });
      html += '<td' + (best ? ' class="best"' : '') + '>' + cl[2](v) + '</td>';
    });
    html += '<td>' + (p.sunEdge ? (p.sunUp ? 'sets in ' : 'rises in ') + fmtSpan(p.sunEdge - p.tMs) : (p.sunUp ? 'up throughout' : 'none')) + '</td>';
    html += '<td>' + (p.earthEdge ? (p.earthUp ? 'lost in ' : 'returns in ') + fmtSpan(p.earthEdge - p.tMs) : (p.earthUp ? 'up throughout' : 'none')) + '</td>';
    html += '<td><button type="button" data-go="' + r + '">Open</button> <button type="button" data-unpin="' + r + '" aria-label="Remove">×</button></td></tr>';
  });
  tb.innerHTML = html;
}
$('cmpTable').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-unpin')) { S.pins.splice(+b.getAttribute('data-unpin'), 1); drawCompare(); return; }
  var p = S.pins[+b.getAttribute('data-go')]; if (!p) return;
  gotoTime(p.tMs); selectSite(SITES.indexOf(p.site)); setView('site');
});

/* ---------- neighbourhood grid (lazy: gunzip + delta decode) ---------- */
function loadGrid(s) {
  if (!s.terr || !s.terr.grid) return Promise.resolve(null);
  if (s.grid) return Promise.resolve(s.grid);
  var M = TERRAIN.meta.grid;
  return gunzipB64(s.terr.grid.gz).then(function (bytes) {
    if (!bytes) return null;
    s.grid = { n: M.n, d: M.spacing_m, hobs: M.hobs_m, masks: LWB.decodeMasks(bytes, M.n * M.n, M.nb), h: s.terr.grid.h, slope: s.terr.grid.slope };
    return s.grid;
  });
}

/* ---------- Pareto ---------- */
var OBJ = {
  irr: { name: 'Mean irradiance', max: true, fmt: wm2, unit: 'W/m2' },
  day: { name: 'Lowest 24 h mean irradiance', max: true, fmt: wm2, unit: 'W/m2' },
  lit: { name: 'Sunlit time', max: true, fmt: pct, unit: '% of period' },
  sun: { name: 'Mean Sun visible', max: true, fmt: pct, unit: '% of disk' },
  earth: { name: 'Earth in view', max: true, fmt: pct, unit: '% of period' },
  dark: { name: 'Longest darkness', max: false, fmt: fmtHours, unit: '' },
  out: { name: 'Longest Earth-link outage', max: false, fmt: fmtHours, unit: '' },
  sunset: { name: 'Time to sunset after landing', max: true, fmt: fmtHours, unit: '' },
  slope: { name: 'Slope', max: false, fmt: function (v) { return v.toFixed(1) + '°'; }, unit: 'deg' }
};
var PF = { pts: [], hover: -1, pick: -1, geom: null, mode: 'near', grid: null, busy: false };
function fillObjSelects() {
  var opts = Object.keys(OBJ).map(function (k) { return '<option value="' + k + '">' + OBJ[k].name + (OBJ[k].max ? ' (more is better)' : ' (less is better)') + '</option>'; }).join('');
  $('pfX').innerHTML = opts; $('pfY').innerHTML = opts; $('pfC').innerHTML = '<option value="">None</option>' + opts;
  $('pfX').value = 'irr'; $('pfY').value = 'earth'; $('pfC').value = '';
}
function objOf(m, slope) { return { irr: m.irrAvg, day: m.irrDayMin, lit: m.litFrac, sun: m.sunAvg, earth: m.earthFrac, dark: m.darkMaxH, out: m.outMaxH, sunset: m.sunsetH, slope: slope }; }
function runPareto() {
  if (PF.busy) return;
  var s = SITES[S.sel], mode = $('pfMode').value;
  PF.mode = mode; PF.hover = -1; PF.pick = -1;
  $('pfRadWrap').hidden = mode !== 'near'; $('pfMap').hidden = mode !== 'near';
  if (mode === 'near') {
    if (!s.terr || !s.terr.grid) { PF.pts = []; PF.msg = 'No terrain grid for this site. Neighbourhood trade-offs need a site inside the 20 m LOLA mosaic (south of 80°S). Try a south-pole site, or switch Candidates to landing dates or all sites.'; drawPareto(); return; }
    PF.busy = true; $('pfPick').textContent = 'Computing the neighbourhood…';
    loadGrid(s).then(function (G) {
      PF.busy = false;
      if (!G) { PF.pts = []; PF.msg = 'This browser cannot unpack the terrain grid.'; drawPareto(); return; }
      var ser = LWB.series(S.tMs, S.horizonD, 60), cm = commsFor(ser) || {}, rad = +$('pfRad').value, n = G.n, pts = [];
      for (var iy = 0; iy < n; iy++) for (var ix = 0; ix < n; ix++) {
        var de = (ix - (n - 1) / 2) * G.d, dn = (iy - (n - 1) / 2) * G.d;
        if (Math.hypot(de, dn) > rad + 1) continue;
        var k = iy * n + ix, ll = LWB.offsetLatLon(s.lat, s.lon, de, dn);
        var q = LWB.makeSite(ll.lat, ll.lon, G.h[k] + G.hobs, G.masks[k], G.hobs), o = objOf(LWB.metricsFrom(q, ser, S.linkMin, cm.gate, cm.relay), G.slope[k]);
        o.de = de; o.dn = dn; o.ix = ix; o.iy = iy; o.lat = ll.lat; o.lon = ll.lon; o.h = G.h[k];
        o.label = de === 0 && dn === 0 ? 'the listed point' : Math.round(Math.hypot(de, dn)) + ' m ' + compass16((Math.atan2(de, dn) * R2D + 360) % 360) + ' of the listed point';
        pts.push(o);
      }
      PF.grid = G; PF.pts = pts; PF.msg = ''; finishPareto();
    });
    return;
  }
  var pts2 = [];
  if (mode === 'sites') {
    var ser2 = LWB.series(S.tMs, S.horizonD, 60), cm2 = commsFor(ser2) || {};
    SITES.forEach(function (q, idx) { if (noTerrainPolar(q)) return; var o = objOf(LWB.metricsFrom(q.geo, ser2, S.linkMin, cm2.gate, cm2.relay), slopeVal(q)); o.label = q.name; o.site = idx; pts2.push(o); });
  } else { // landing dates at this site, every 12 h across the dial, each on its own hourly series
    var slope = slopeVal(s);
    for (var d0 = 0; d0 < S.spanD * 2; d0++) {
      var t0 = S.startMs + d0 * DAY / 2, o2 = objOf(slipMetrics(s, t0), slope);
      o2.t = t0; o2.label = 'landing ' + fmtDT(t0); pts2.push(o2);
    }
  }
  PF.pts = pts2; PF.msg = ''; finishPareto();
}
function finishPareto() {
  var kx = $('pfX').value, ky = $('pfY').value, kc = $('pfC').value, keys = [kx, ky].concat(kc && kc !== kx && kc !== ky ? [kc] : []);
  if (kx === ky) { PF.pts = []; PF.msg = 'Choose two different objectives.'; drawPareto(); return; }
  var smax = parseFloat($('pfSlope').value), steep = 0;
  var pts = PF.pts.filter(function (p) { if (isFinite(smax) && p.slope > smax) { steep++; return false; } return keys.every(function (k) { return isFinite(p[k]); }); });
  var dropped = PF.pts.length - pts.length - steep;
  PF.pts = pts; PF.keys = keys;
  if (!pts.length) { PF.msg = steep ? 'Every candidate is steeper than your slope limit.' : 'No candidate has a value for every chosen objective (slope is known only where LOLA terrain is loaded).'; drawPareto(); return; }
  var rank = LWB.paretoRanks(pts, keys.map(function (k) { return { key: k, max: OBJ[k].max }; }));
  var rng = {}; keys.forEach(function (k) { var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; }); rng[k] = [lo, hi]; });
  var best = -1, bs = -1;
  pts.forEach(function (p, i) {
    p.rank = rank[i]; p.score = 0;
    keys.forEach(function (k) { var r = rng[k], u = r[1] > r[0] ? (p[k] - r[0]) / (r[1] - r[0]) : 1; p.score += OBJ[k].max ? u : 1 - u; });
    if (p.rank === 0 && p.score > bs) { bs = p.score; best = i; }
  });
  PF.rng = rng; PF.best = best;
  var nf = pts.filter(function (p) { return p.rank === 0; }).length, b = pts[best];
  var txt = '<b>Best equal-weight candidate: ' + esc(b.label) + '.</b> ' + keys.map(function (k) { return OBJ[k].name + ' ' + OBJ[k].fmt(b[k]); }).join(', ') + '. ';
  txt += 'It is one of ' + nf + ' candidate' + (nf > 1 ? 's' : '') + ' out of ' + pts.length + ' that no other candidate beats on every chosen objective, and it scores best among them when the chosen objectives are scaled to their range here and weighted equally. Different weights give a different pick; every bright point is defensible.';
  if (PF.mode === 'near') { var c0 = pts.filter(function (p) { return p.de === 0 && p.dn === 0; })[0]; if (c0 && c0 !== b) txt += ' The listed point itself: ' + keys.map(function (k) { return OBJ[k].fmt(c0[k]); }).join(', ') + '.'; }
  $('pfPick').innerHTML = txt;
  $('pfNote').innerHTML = 'Period: ' + S.horizonD + ' days from ' + iso(PF.mode === 'dates' ? S.startMs : S.tMs) + (PF.mode === 'dates' ? ' onward, one candidate every 12 h, each sampled hourly' : ', sampled hourly') + '. Irradiance is on a Sun-facing surface. ' + esc(linkRuleText()) + ' ' +
    (PF.mode === 'near' ? 'Candidates are the points of the 100 m LOLA horizon-mask grid (observer ' + TERRAIN.meta.grid.hobs_m + ' m above ground); slope is the ' + PF.grid.slope.length + '-point grid value from the ' + SITES[S.sel].terr.grid.slope_grid + ' DEM. ' : '') +
    'Bright points are the non-dominated front (fast non-dominated sorting). ' + (steep ? steep + ' candidate' + (steep > 1 ? 's' : '') + ' steeper than ' + smax + '° left out. ' : '') + (dropped ? dropped + ' candidate' + (dropped > 1 ? 's' : '') + ' without a slope value left out. ' : '') + 'With three objectives most points become non-dominated, so the tool stops at three.';
  drawPareto();
}
function ramp(u) { // dark blue -> teal -> yellow
  u = clamp(u, 0, 1);
  var r = u < 0.5 ? 40 + 40 * u : 60 + 380 * (u - 0.5), g = 60 + 170 * u, b = u < 0.5 ? 120 + 60 * u : 150 - 220 * (u - 0.5);
  return 'rgb(' + Math.round(clamp(r, 0, 255)) + ',' + Math.round(clamp(g, 0, 255)) + ',' + Math.round(clamp(b, 0, 255)) + ')';
}
function drawPareto() {
  var F = fit($('pf'), 320), c = F.c, w = F.w, h = F.h, pts = PF.pts;
  if (!pts.length) { c.fillStyle = C2['--mute']; c.font = '12px "IBM Plex Mono", monospace'; c.textAlign = 'left'; wrapText(c, PF.msg || 'Press Update.', 10, 24, w - 20, 17); $('pfPick').textContent = ''; $('pfNote').textContent = ''; $('pfRead').textContent = ''; PF.geom = null; drawPfMap(); return; }
  var kx = PF.keys[0], ky = PF.keys[1], kc = PF.keys[2], L = 58, R = 14, T = 14, B = 40, pw = w - L - R, ph = h - T - B;
  function ext(k) { var r = PF.rng[k], pd = (r[1] - r[0]) * 0.08 || Math.abs(r[1]) * 0.05 || 0.5; return [r[0] - pd, r[1] + pd]; }
  var ex = ext(kx), ey = ext(ky);
  // "better" always points right and up
  function X(v) { var u = (v - ex[0]) / (ex[1] - ex[0]); return L + (OBJ[kx].max ? u : 1 - u) * pw; }
  function Y(v) { var u = (v - ey[0]) / (ey[1] - ey[0]); return T + (OBJ[ky].max ? 1 - u : u) * ph; }
  c.strokeStyle = C2['--line']; c.lineWidth = 1; c.strokeRect(L + 0.5, T + 0.5, pw, ph);
  c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = C2['--mute'];
  for (var q = 0; q <= 4; q++) {
    var vx = PF.rng[kx][0] + (PF.rng[kx][1] - PF.rng[kx][0]) * q / 4, vy = PF.rng[ky][0] + (PF.rng[ky][1] - PF.rng[ky][0]) * q / 4;
    c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(OBJ[kx].fmt(vx), X(vx), T + ph + 5);
    c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(OBJ[ky].fmt(vy), L - 5, Y(vy));
  }
  c.fillStyle = C2['--ink']; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(OBJ[kx].name + '  (better →)', L + pw / 2, h - 4);
  c.save(); c.translate(11, T + ph / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(OBJ[ky].name + '  (better →)', 0, 0); c.restore();
  // front as a staircase
  var fr = pts.filter(function (p) { return p.rank === 0; }).sort(function (a, b) { return X(a[kx]) - X(b[kx]); });
  if (!kc && fr.length > 1) { c.strokeStyle = C2['--go']; c.globalAlpha = 0.6; c.lineWidth = 1.2; c.beginPath(); fr.forEach(function (p, i) { if (i) { c.lineTo(X(p[kx]), Y(fr[i - 1][ky])); c.lineTo(X(p[kx]), Y(p[ky])); } else c.moveTo(X(p[kx]), Y(p[ky])); }); c.stroke(); c.globalAlpha = 1; }
  var G = [];
  pts.forEach(function (p, i) {
    var x = X(p[kx]), y = Y(p[ky]), front = p.rank === 0; G.push([x, y]);
    var col = kc ? ramp((p[kc] - PF.rng[kc][0]) / ((PF.rng[kc][1] - PF.rng[kc][0]) || 1) * (OBJ[kc].max ? 1 : -1) + (OBJ[kc].max ? 0 : 1)) : (front ? C2['--go'] : C2['--faint']);
    c.globalAlpha = front ? 1 : 0.4; c.fillStyle = col; c.beginPath(); c.arc(x, y, front ? 4.5 : 3, 0, 6.2832); c.fill();
    if (front) { c.strokeStyle = C2['--panel']; c.lineWidth = 1; c.stroke(); }
    c.globalAlpha = 1;
  });
  function ring(i, col, r) { if (i < 0 || !G[i]) return; c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(G[i][0], G[i][1], r, 0, 6.2832); c.stroke(); }
  ring(PF.best, C2['--go'], 9); ring(PF.pick, C2['--ink'], 8); ring(PF.hover, C2['--sun'], 7);
  if (kc) { c.font = '10px "IBM Plex Mono", monospace'; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillStyle = C2['--mute']; c.fillText('colour: ' + OBJ[kc].name + ', yellow is better', L + pw - 4, T + 4); }
  PF.geom = G;
  drawPfMap();
}
function wrapText(c, text, x, y, maxW, lh) { var words = text.split(' '), line = ''; words.forEach(function (wd) { if (c.measureText(line + wd).width > maxW && line) { c.fillText(line, x, y); y += lh; line = ''; } line += wd + ' '; }); c.fillText(line, x, y); }
function drawPfMap() {
  var cv = $('pfMap'); if (cv.hidden) return;
  var w0 = Math.min(cv.clientWidth || 300, 360); cv.style.height = w0 + 'px';
  var F = fit(cv, w0), c = F.c, w = F.w, pts = PF.pts;
  if (PF.mode !== 'near' || !pts.length || !PF.grid) return;
  var n = PF.grid.n, cs = w / n, kx = PF.keys[0], r = PF.rng[kx];
  c.fillStyle = '#10151c'; c.fillRect(0, 0, w, w);
  pts.forEach(function (p, i) {
    var u = (p[kx] - r[0]) / ((r[1] - r[0]) || 1); if (!OBJ[kx].max) u = 1 - u;
    var x = p.ix * cs, y = (n - 1 - p.iy) * cs;
    c.fillStyle = ramp(u); c.fillRect(x, y, cs + 0.5, cs + 0.5);
    if (p.rank === 0) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3); }
  });
  function mark(i, col) { if (i < 0 || !pts[i]) return; var p = pts[i]; c.strokeStyle = col; c.lineWidth = 2.5; c.strokeRect(p.ix * cs + 1, (n - 1 - p.iy) * cs + 1, cs - 2, cs - 2); }
  mark(PF.best, C2['--go']); mark(PF.pick, '#fff'); mark(PF.hover, C2['--sun']);
  c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(w / 2 - 6, w / 2); c.lineTo(w / 2 + 6, w / 2); c.moveTo(w / 2, w / 2 - 6); c.lineTo(w / 2, w / 2 + 6); c.stroke();
  c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.8)'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText('N ↑   ' + OBJ[kx].name + ', yellow is better', 5, 5);
  c.textBaseline = 'bottom'; c.fillText((n - 1) * PF.grid.d / 1000 + ' km across, ' + PF.grid.d + ' m cells', 5, w - 5);
}
function pfRead(i) {
  var p = PF.pts[i]; if (!p) { $('pfRead').textContent = ''; return; }
  $('pfRead').textContent = p.label + (p.rank === 0 ? ' (on the front)' : ' (beaten by another candidate)') + ': ' + PF.keys.map(function (k) { return OBJ[k].name + ' ' + OBJ[k].fmt(p[k]); }).join(', ') +
    (p.lat !== undefined ? ' · ' + p.lat.toFixed(4) + ', ' + ((p.lon + 360) % 360).toFixed(4) + '°E, height ' + Math.round(p.h) + ' m' : '') + (PF.mode !== 'near' ? ' · click to open' : '');
}
function pfNearest(e, cv) {
  if (!PF.geom) return -1;
  var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = 14;
  PF.geom.forEach(function (g, i) { var d = Math.hypot(g[0] - x, g[1] - y) - (PF.pts[i].rank === 0 ? 2 : 0); if (d < bd) { bd = d; best = i; } });
  return best;
}
$('pf').addEventListener('pointermove', function (e) { var i = pfNearest(e, this); if (i !== PF.hover) { PF.hover = i; drawPareto(); pfRead(i >= 0 ? i : PF.pick); } });
$('pf').addEventListener('click', function (e) {
  var i = pfNearest(e, this); if (i < 0) return;
  var p = PF.pts[i]; PF.pick = i;
  if (PF.mode === 'sites') { selectSite(p.site); setView('site'); return; }
  if (PF.mode === 'dates') { gotoTime(p.t); setView('site'); return; }
  drawPareto(); pfRead(i);
});
function pfMapIndex(e, cv) {
  if (PF.mode !== 'near' || !PF.grid) return -1;
  var r = cv.getBoundingClientRect(), n = PF.grid.n, ix = Math.floor((e.clientX - r.left) / r.width * n), iy = n - 1 - Math.floor((e.clientY - r.top) / r.height * n);
  for (var i = 0; i < PF.pts.length; i++) if (PF.pts[i].ix === ix && PF.pts[i].iy === iy) return i;
  return -1;
}
$('pfMap').addEventListener('pointermove', function (e) { var i = pfMapIndex(e, this); if (i !== PF.hover) { PF.hover = i; drawPareto(); pfRead(i >= 0 ? i : PF.pick); } });
$('pfMap').addEventListener('click', function (e) { var i = pfMapIndex(e, this); if (i >= 0) { PF.pick = i; drawPareto(); pfRead(i); } });
$('pfRun').addEventListener('click', runPareto);
['pfMode', 'pfRad', 'pfX', 'pfY', 'pfC', 'pfSlope'].forEach(function (id) { $(id).addEventListener('change', runPareto); });

function setTab(k) {
  S.tab = k;
  ['compare', 'pareto'].forEach(function (t) { $('tab-' + t).hidden = t !== k; });
  Array.prototype.forEach.call(document.querySelectorAll('.atabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === k ? 'true' : 'false'); });
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.subnav button[data-tab]'));
  if (tabBtns.some(function (b) { return b.getAttribute('aria-current') === 'true'; })) tabBtns.forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-tab') === k ? 'true' : 'false'); });
  if (S.view !== 'list') return;
  if (k === 'compare') drawCompare(); else { if (!PF.pts.length) runPareto(); else drawPareto(); }
}
Array.prototype.forEach.call(document.querySelectorAll('.atabs button'), function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
