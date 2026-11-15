/* ================= communication: ground antennas and relay satellites ================= */
/* A moment has a link when
     direct:  Earth's centre clears the local skyline by the user's margin (S.linkMin), and, when a ground antenna
              is required, a ticked antenna has the Moon above that antenna's elevation limit; or
     relay:   a relay satellite the user entered clears the local skyline by its own margin, the straight line from
              the satellite to Earth's centre passes outside the Moon's 1737.4 km sphere, and, when a ground antenna
              is required, a ticked antenna has the satellite above its elevation limit.
   Satellites come from the user, as state vectors (Sharif's choice: not orbital elements): one Moon-centred
   position and velocity at an epoch, moved as a two-body orbit about the Moon (GM below), or a JPL Horizons vector
   table centred on the Moon. Positions are converted to the page's body-fixed frame with the IAU rotation model
   (astronomy-engine), the same rotation the fallback ephemeris uses. Terrain: a satellite is tested against the
   LOLA skyline at its azimuth; for anything tens of km up or more this is the same as tracing the ray, because a
   satellite low enough to sit in front of a skyline ridge would have to be below the ridge's own height. */
var GM_MOON = 4902.800118;   // km^3/s^2, JPL DE440 (Park et al. 2021)
var TDB_UTC_MS = 69184;      // TT - UTC = 32.184 s + 37 leap seconds (since 2017-01-01); TDB - TT < 2 ms
var OBL_J2000 = 84381.448 / 3600 * D2R;  // Horizons' J2000 ecliptic obliquity
var COMMS = { stations: [], sats: [], err: '' };
function dsnStations() {
  return DSN.map(function (q, k) { return { id: 'dsn' + k, name: q.name, lat: q.obs.latitude, lon: q.obs.longitude, h_m: q.obs.height, minEl: DSN_EL, on: true, builtin: true }; });
}
function loadComms() {
  var st = dsnStations(), sats = [];
  try {
    var raw = JSON.parse(localStorage.getItem('lwb.comms.v1') || 'null');
    if (raw) {
      (raw.off || []).forEach(function (id) { st.forEach(function (q) { if (q.id === id) q.on = false; }); });
      (raw.st || []).forEach(function (q) { if (okStation(q)) st.push(stationOf(q)); });
      (raw.sats || []).forEach(function (q) { var s = satOf(q); if (s) sats.push(s); });
    }
  } catch (x) {}
  COMMS.stations = st; COMMS.sats = sats;
}
function saveComms() {
  try {
    localStorage.setItem('lwb.comms.v1', JSON.stringify({
      off: COMMS.stations.filter(function (q) { return q.builtin && !q.on; }).map(function (q) { return q.id; }),
      st: COMMS.stations.filter(function (q) { return !q.builtin; }).map(function (q) { return { name: q.name, lat: q.lat, lon: q.lon, h_m: q.h_m, minEl: q.minEl, on: q.on }; }),
      sats: COMMS.sats.map(function (q) { return q.rec; })
    }));
  } catch (x) {}
}
function okStation(q) { return q && isFinite(q.lat) && isFinite(q.lon) && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 360 && isFinite(q.minEl) && q.minEl >= -5 && q.minEl <= 90; }
function stationOf(q) {
  var lon = ((+q.lon + 540) % 360) - 180;
  return { id: 'u' + Math.random().toString(36).slice(2, 8), name: String(q.name || 'Antenna').slice(0, 60), lat: +q.lat, lon: lon, h_m: +q.h_m || 0, minEl: +q.minEl, on: q.on !== false, builtin: false };
}
function stationsOn() { return COMMS.stations.filter(function (q) { return q.on; }); }
function satsOn() { return COMMS.sats.filter(function (q) { return q.on; }); }
function commsActive() { return S.ground || satsOn().length > 0; }

/* ---------- satellites ---------- */
/* rec (what is stored): {kind:'kep', name, r:[km], v:[km/s] Moon-centred at epoch (ms UTC), frame:'icrf'|'moon', minEl, on} or {kind:'tab', name, t:[ms UTC], p:[x,y,z,...] km ICRF Moon-centred, v:[...] km/s or null, minEl, on}. */
function satOf(rec) {
  if (!rec || (rec.kind !== 'kep' && rec.kind !== 'tab')) return null;
  if (!rec.id) rec.id = Math.random().toString(36).slice(2, 10);
  var s = { rec: rec, name: String(rec.name || 'Relay').slice(0, 60), minEl: isFinite(rec.minEl) ? +rec.minEl : 0, on: rec.on !== false, kind: rec.kind };
  if (rec.kind === 'kep') {
    // state vector at the epoch -> two-body ellipse (perifocal axes P, Q in ICRF, mean anomaly at the epoch)
    var r = (rec.r || []).map(Number), v = (rec.v || []).map(Number);
    if (r.length !== 3 || v.length !== 3 || !r.concat(v).every(isFinite) || !isFinite(rec.epoch)) return null;
    if (rec.frame === 'moon') { // axes: Moon equator and IAU node at the epoch, held fixed in ICRF
      var ax = LWB.aeAxes(Astronomy.MakeTime(new Date(+rec.epoch))), X = ax.node, Z = ax.z, Y = cross(Z, X);
      var tr = function (u) { return [u[0] * X[0] + u[1] * Y[0] + u[2] * Z[0], u[0] * X[1] + u[1] * Y[1] + u[2] * Z[1], u[0] * X[2] + u[1] * Y[2] + u[2] * Z[2]]; };
      r = tr(r); v = tr(v);
    }
    var mu = GM_MOON, rn = Math.hypot(r[0], r[1], r[2]), v2 = dot(v, v), h = cross(r, v), hn = Math.hypot(h[0], h[1], h[2]);
    var a = 1 / (2 / rn - v2 / mu);
    if (!(rn > RM) || !(hn > 0) || !(a > 0)) return null;           // below the surface, radial, or not bound
    var ev = sub(scl(cross(v, h), 1 / mu), scl(r, 1 / rn)), e = Math.hypot(ev[0], ev[1], ev[2]);
    if (!(e < 1)) return null;
    var P = e > 1e-10 ? scl(ev, 1 / e) : scl(r, 1 / rn), Q = unit(cross(h, P)), E0;
    if (e > 1e-10) E0 = Math.atan2(dot(r, v) / Math.sqrt(mu * a), 1 - rn / a);  // e sinE, e cosE
    else E0 = 0;
    s.a = a; s.e = e; s.P = P; s.Q = Q; s.M0 = E0 - e * Math.sin(E0); s.n = Math.sqrt(mu / (a * a * a));
    s.periodH = 2 * Math.PI / s.n / 3600; s.periAlt = a * (1 - e) - RM; s.apoAlt = a * (1 + e) - RM;
    s.inc = Math.acos(clamp(h[2] / hn, -1, 1)) * R2D;               // to the ICRF equator
    if (s.periAlt < 0) return null;                                 // the orbit hits the Moon
  } else {
    if (!rec.t || rec.t.length < 2 || rec.p.length !== rec.t.length * 3) return null;
    s.t0 = rec.t[0]; s.t1 = rec.t[rec.t.length - 1];
  }
  return s;
}
/* Moon-centred ICRF position (km) at UTC ms, or null where the satellite is not defined (outside a table). */
function satICRF(s, ms) {
  if (s.kind === 'kep') {
    var M = (s.M0 + s.n * (ms - s.rec.epoch) / 1000) % (2 * Math.PI), e = s.e, E = e < 0.8 ? M : Math.PI;
    for (var k = 0; k < 30; k++) { var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-12) break; }
    var x = s.a * (Math.cos(E) - e), y = s.a * Math.sqrt(1 - e * e) * Math.sin(E);
    return [x * s.P[0] + y * s.Q[0], x * s.P[1] + y * s.Q[1], x * s.P[2] + y * s.Q[2]];
  }
  var r = s.rec, t = r.t, n = t.length;
  if (ms < s.t0 || ms > s.t1) return null;
  var lo = 0, hi = n - 1;
  while (hi - lo > 1) { var m = (lo + hi) >> 1; if (t[m] <= ms) lo = m; else hi = m; }
  var h = t[hi] - t[lo], u = h > 0 ? (ms - t[lo]) / h : 0, p = r.p, out = [0, 0, 0];
  if (r.v) { // cubic Hermite with the table's velocities
    var h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u, hs = h / 1000;
    for (var j = 0; j < 3; j++) out[j] = h00 * p[lo * 3 + j] + h10 * hs * r.v[lo * 3 + j] + h01 * p[hi * 3 + j] + h11 * hs * r.v[hi * 3 + j];
  } else for (var j2 = 0; j2 < 3; j2++) out[j2] = p[lo * 3 + j2] * (1 - u) + p[hi * 3 + j2] * u;
  return out;
}
function icrfToME(v, ax) { return [dot(v, ax.x), dot(v, ax.y), dot(v, ax.z)]; }
function satME(s, ms) { var v = satICRF(s, ms); return v ? icrfToME(v, LWB.aeAxes(Astronomy.MakeTime(new Date(ms)))) : null; }
/* The segment from the satellite to Earth's centre misses the Moon's sphere. */
function clearOfMoon(p, e) {
  var d = [e[0] - p[0], e[1] - p[1], e[2] - p[2]], dd = dot(d, d), u = clamp(-dot(p, d) / dd, 0, 1);
  var c = [p[0] + u * d[0], p[1] + u * d[1], p[2] + u * d[2]];
  return dot(c, c) > RM * RM;
}
/* Ground antennas: elevation of a geocentric target (km, ICRF) from each ticked antenna. */
function stationVecs(f, list) { return list.map(function (q) { var v = Astronomy.ObserverVector(f.time, new Astronomy.Observer(q.lat, q.lon, q.h_m), false); return [v.x * AU, v.y * AU, v.z * AU]; }); }
function anySees(list, vecs, target) {
  for (var k = 0; k < list.length; k++) {
    var s = vecs[k], rel = sub(target, s), L = Math.hypot(rel[0], rel[1], rel[2]), R = Math.hypot(s[0], s[1], s[2]);
    if (Math.asin(dot(rel, s) / (L * R)) * R2D >= list[k].minEl) return true;
  }
  return false;
}
/* Per-time comms state for a list of times: moon[i] (direct-link gate), and per satellite its body-fixed position
   (NaN where undefined) and ok (Earth in view past the limb and, if required, an antenna sees it).
   Antenna visibility is evaluated every `every` samples and held, as before. */
function commsSeries(n, times, earthME, every) {
  var st = stationsOn(), sats = satsOn(), K = sats.length;
  var out = { n: n, k: K, moon: new Uint8Array(n), pos: new Float64Array(n * K * 3), ok: new Uint8Array(n * K), gs: new Uint8Array(n * K), minEl: sats.map(function (q) { return q.minEl; }), sats: sats };
  var vecs = null, f = null, held = new Uint8Array(K), seen = new Uint8Array(K);
  for (var i = 0; i < n; i++) {
    var ms = times(i), need = S.ground && (i % every === 0 || !vecs);
    if (need || K) f = frame(ms);
    if (need) vecs = stationVecs(f, st);
    if (!S.ground) out.moon[i] = 1;
    else if (i % every === 0) out.moon[i] = st.length && anySees(st, vecs, f.moonKm) ? 1 : 0;
    else out.moon[i] = out.moon[i - 1];
    for (var k = 0; k < K; k++) {
      var o = (i * K + k) * 3, v = satICRF(sats[k], ms);
      if (!v || Math.hypot(v[0], v[1], v[2]) < RM) { out.pos[o] = out.pos[o + 1] = out.pos[o + 2] = NaN; continue; }
      var p = icrfToME(v, f.ax); out.pos[o] = p[0]; out.pos[o + 1] = p[1]; out.pos[o + 2] = p[2];
      if (S.ground && (i % every === 0 || !seen[k])) { held[k] = st.length && anySees(st, vecs, addS(f.moonKm, v, 1)) ? 1 : 0; seen[k] = 1; }
      out.gs[i * K + k] = S.ground ? held[k] : 1;
      out.ok[i * K + k] = out.gs[i * K + k] && clearOfMoon(p, [earthME[i * 3], earthME[i * 3 + 1], earthME[i * 3 + 2]]) ? 1 : 0;
    }
  }
  return out;
}
/* For LWB.metricsFrom on a uniform series. Null when nothing beyond the direct line of sight is asked for. */
/* Cached on the series' grid: the slip chart and the trade-off plot ask for 120 overlapping 12-h-spaced series, which
   all fall on one hourly grid from the period start. Antennas are evaluated at every sample for steps of 30 min and
   more, so a slice of a longer series is identical to a series computed on its own. */
var CCACHE = null;
function commsFor(ser) {
  if (!commsActive()) return null;
  var step = ser.stepMs, key = commsKey() + ':' + step, C = CCACHE, every = Math.max(1, Math.round(1800000 / step));
  var fits = C && C.key === key && ser.t0 >= C.t0 && (ser.t0 - C.t0) % step === 0 && (ser.t0 - C.t0) / step + ser.n <= C.n;
  if (!fits) {
    var t0 = ser.t0, t1 = ser.t0 + (ser.n - 1) * step, a = S.startMs, b = S.startMs + (S.spanD + S.horizonD) * DAY;
    if (every === 1 && ser.t0 >= a && (ser.t0 - a) % step === 0 && t1 <= b) { t0 = a; t1 = b; }
    var n = Math.round((t1 - t0) / step) + 1, earth = new Float64Array(n * 3), d = LWB.newDirs();
    for (var i = 0; i < n; i++) { LWB.dirs(t0 + i * step, d); earth[i * 3] = d.earth[0]; earth[i * 3 + 1] = d.earth[1]; earth[i * 3 + 2] = d.earth[2]; }
    CCACHE = C = { key: key, t0: t0, n: n, R: commsSeries(n, function (j) { return t0 + j * step; }, earth, every) };
  }
  var o = (ser.t0 - C.t0) / step, R = C.R, K = R.k, m = ser.n;
  var sl = { n: m, k: K, moon: R.moon.subarray(o, o + m), pos: R.pos.subarray(o * K * 3, (o + m) * K * 3), ok: R.ok.subarray(o * K, (o + m) * K), gs: R.gs.subarray(o * K, (o + m) * K), minEl: R.minEl, sats: R.sats };
  return { gate: S.ground ? sl.moon : null, relay: K ? sl : null };
}
/* Relay state of one site at one instant (continuous in time except the antenna sample). */
function relayAt(s, ms, i) {
  var C = STEPS.comms; if (!C || !C.k) return -1;
  var d = LWB.dirs(ms, _cd), t = {}, ax = LWB.aeAxes(Astronomy.MakeTime(new Date(ms)));
  for (var k = 0; k < C.k; k++) {
    var v = satICRF(C.sats[k], ms); if (!v || Math.hypot(v[0], v[1], v[2]) < RM) continue;
    var p = icrfToME(v, ax);
    if (!C.gs[i * C.k + k]) continue;
    if (!clearOfMoon(p, d.earth)) continue;
    LWB.topo(s.geo, p, t);
    if (t.el - LWB.horizonAt(s.geo, t.az) >= C.minEl[k]) return k;
  }
  return -1;
}
var _cd = LWB.newDirs();
/* Everything about comms that changes a number, as one string for cache keys. */
function commsKey() {
  return (S.ground ? 'g' + stationsOn().map(function (q) { return [q.lat, q.lon, q.h_m, q.minEl].join(','); }).join('|') : '') + '/' + satsOn().map(function (q) { return q.rec.id + ':' + q.minEl; }).join('|');
}
/* ---------- JPL Horizons vector table ---------- */
/* Accepts the default text layout and the CSV layout. Centre must be the Moon. Reference plane: ICRF/J2000 equator
   ("FRAME") or the J2000 ecliptic, rotated to the equator by Horizons' obliquity. Units KM-S, KM-D or AU-D.
   Times: TDB (Horizons' default for vectors) converted to UTC; a JDUT column is taken as UTC. */
function parseHorizons(txt) {
  var a = txt.indexOf('$$SOE'), b = txt.indexOf('$$EOE');
  if (a < 0 || b < a) throw new Error('No $$SOE … $$EOE block: paste the whole Horizons output.');
  var head = txt.slice(0, a), body = txt.slice(a + 5, b);
  var cm = head.match(/Center body name\s*:\s*([^\n(]+)/i);
  if (cm && !/moon/i.test(cm[1])) throw new Error('The table is centred on ' + cm[1].trim() + '. Set Coordinate center to the Moon (500@301) in Horizons.');
  if (!cm) throw new Error('The header with the coordinate centre is missing: paste the output with its header.');
  // "Reference frame : ICRF" (Earth-equator axes) or "Reference frame : Ecliptic of J2000.0"
  var pl = head.match(/Reference (?:frame|plane)\s*:\s*([^\n]+)/i), ecl;
  if (!pl) throw new Error('The header line "Reference frame" is missing, so the axes are unknown: paste the output with its header.');
  ecl = /ecliptic/i.test(pl[1]);
  if (!ecl && !/ICRF|FRAME|equator/i.test(pl[1])) throw new Error('Reference frame "' + pl[1].trim() + '" is not ICRF or the J2000 ecliptic.');
  var un = (head.match(/Output units\s*:\s*(\S+)/i) || [, 'KM-S'])[1].toUpperCase();
  var kmPer = /^AU/.test(un) ? 149597870.7 : 1, perS = /-D$/.test(un) ? 1 / 86400 : 1;
  var ut = /JDUT/i.test(head) || /\bUT\b/.test(body.slice(0, 200)), off = ut ? 0 : TDB_UTC_MS;
  var rows = [];
  function num(s) { var v = parseFloat(s); return isFinite(v) ? v : NaN; }
  var re = /(\d{7}\.\d+)\s*=\s*A\.D\.[^\n]*\n\s*X\s*=\s*(\S+)\s*Y\s*=\s*(\S+)\s*Z\s*=\s*(\S+)(?:\s*\n\s*VX\s*=\s*(\S+)\s*VY\s*=\s*(\S+)\s*VZ\s*=\s*(\S+))?/g, m;
  while ((m = re.exec(body))) rows.push([num(m[1]), num(m[2]), num(m[3]), num(m[4]), num(m[5]), num(m[6]), num(m[7])]);
  if (!rows.length) body.split(/\r?\n/).forEach(function (line) {
    var f = line.split(','); if (f.length < 5) return;
    var jd = num(f[0]); if (!(jd > 2e6)) return;
    rows.push([jd, num(f[2]), num(f[3]), num(f[4]), num(f[5]), num(f[6]), num(f[7])]);
  });
  rows = rows.filter(function (r) { return isFinite(r[0]) && isFinite(r[1]) && isFinite(r[2]) && isFinite(r[3]); });
  if (rows.length < 2) throw new Error('Fewer than two rows with a time and X, Y, Z could be read.');
  rows.sort(function (p, q) { return p[0] - q[0]; });
  rows = rows.filter(function (r, i) { return !i || r[0] > rows[i - 1][0]; }).slice(0, 20000);
  var hasV = rows.every(function (r) { return isFinite(r[4]) && isFinite(r[5]) && isFinite(r[6]); });
  var ce = Math.cos(OBL_J2000), se = Math.sin(OBL_J2000);
  function eq(x, y, z) { return ecl ? [x, y * ce - z * se, y * se + z * ce] : [x, y, z]; }
  var t = [], p = [], v = hasV ? [] : null;
  rows.forEach(function (r) {
    t.push(Math.round((r[0] - 2440587.5) * 86400000 - off));
    var q = eq(r[1] * kmPer, r[2] * kmPer, r[3] * kmPer); p.push(q[0], q[1], q[2]);
    if (hasV) { var w = eq(r[4] * kmPer * perS, r[5] * kmPer * perS, r[6] * kmPer * perS); v.push(w[0], w[1], w[2]); }
  });
  return { t: t, p: p, v: v, note: rows.length + ' rows, ' + (ecl ? 'J2000 ecliptic rotated to the equator' : 'ICRF equator') + ', ' + un + ', ' + (ut ? 'UT' : 'TDB to UTC') + (hasV ? ', Hermite with velocities' : ', linear between rows (no velocities)') };
}

/* ---------- drawer ---------- */
function satSummary(q) {
  var r = q.rec;
  if (q.kind === 'kep') return 'State at ' + iso(r.epoch) + ' (' + (r.frame === 'moon' ? 'Moon-equator axes' : 'ICRF') + '), two-body: ' + Math.round(q.periAlt).toLocaleString('en-US') + ' × ' + Math.round(q.apoAlt).toLocaleString('en-US') + ' km altitude, inclination ' + q.inc.toFixed(1) + '° to the ICRF equator, period ' + fmtHours(q.periodH);
  return 'Horizons table: ' + iso(q.t0) + ' to ' + iso(q.t1) + (r.note ? ' · ' + r.note : '');
}
function renderComms() {
  $('gsList').innerHTML = COMMS.stations.map(function (q) {
    return '<div class="comrow"><input type="checkbox" data-st="' + q.id + '"' + (q.on ? ' checked' : '') + ' aria-label="Use ' + esc(q.name) + '"><span><b>' + esc(q.name) + '</b><span class="mu">' + fmtCoord(q.lat, q.lon) + ', ' + Math.round(q.h_m) + ' m · Moon above ' + q.minEl.toFixed(1) + '°' + (q.builtin ? ' · ' + DSN_SRC : '') + '</span></span>' +
      (q.builtin ? '<span></span>' : '<button type="button" class="ghost" data-delst="' + q.id + '" aria-label="Remove ' + esc(q.name) + '">×</button>') + '</div>';
  }).join('');
  var L = SITES[S.sel] && SITES[S.sel].geo, t = {};
  $('satList').innerHTML = COMMS.sats.length ? COMMS.sats.map(function (q, k) {
    var now = '', p = L ? satME(q, S.tMs) : null;
    if (p) { LWB.topo(L, p, t); var mar = t.el - LWB.horizonAt(L, t.az); now = ' · now from ' + esc(SITES[S.sel].name.split(',')[0]) + ': ' + deg2(t.el) + ' elevation, ' + (mar >= 0 ? deg2(mar) + ' above' : deg2(-mar) + ' below') + ' the skyline, ' + Math.round(t.range).toLocaleString('en-US') + ' km'; }
    else if (L) now = ' · not defined at the dial time';
    return '<div class="comrow"><input type="checkbox" data-sat="' + k + '"' + (q.on ? ' checked' : '') + ' aria-label="Use ' + esc(q.name) + '"><span><b>' + esc(q.name) + '</b><span class="mu">' + esc(satSummary(q)) + ' · counts ' + (q.minEl ? q.minEl + '° or more' : 'anywhere') + ' above the skyline' + now + '</span></span><button type="button" class="ghost" data-delsat="' + k + '" aria-label="Remove ' + esc(q.name) + '">×</button></div>';
  }).join('') + '<p class="hint">Stations and satellites are saved in this browser; a copied link does not carry them.</p>' : '<p class="hint">None. Add one to count a link through it.</p>';
}
function commsChanged() { saveComms(); renderComms(); recompute(true); }
$('gsList').addEventListener('change', function (e) { var id = e.target.getAttribute('data-st'); COMMS.stations.forEach(function (q) { if (q.id === id) q.on = e.target.checked; }); commsChanged(); });
$('gsList').addEventListener('click', function (e) { var b = e.target.closest('[data-delst]'); if (!b) return; var id = b.getAttribute('data-delst'); COMMS.stations = COMMS.stations.filter(function (q) { return q.id !== id; }); commsChanged(); });
$('gsForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var q = { name: $('gsName').value.trim() || 'Antenna', lat: parseFloat($('gsLat').value), lon: parseFloat($('gsLon').value), h_m: parseFloat($('gsH').value) || 0, minEl: parseFloat($('gsEl').value) };
  if (!okStation(q)) return;
  COMMS.stations.push(stationOf(q)); $('gsForm').reset(); $('gsAdd').open = false; commsChanged();
});
$('satList').addEventListener('change', function (e) { var k = e.target.getAttribute('data-sat'); if (k === null) return; var q = COMMS.sats[+k]; q.on = q.rec.on = e.target.checked; commsChanged(); });
$('satList').addEventListener('click', function (e) { var b = e.target.closest('[data-delsat]'); if (!b) return; COMMS.sats.splice(+b.getAttribute('data-delsat'), 1); commsChanged(); });
$('satKind').addEventListener('change', function () { var tab = this.value === 'tab'; document.querySelector('#satForm .kep').hidden = tab; document.querySelector('#satForm .tab').hidden = !tab; });
$('satAdd').addEventListener('toggle', function () { if (this.open && !$('satEpoch').value) $('satEpoch').value = new Date(Math.round(S.tMs / 60000) * 60000).toISOString().slice(0, 16); });
$('satForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var msg = $('satMsg'), name = $('satName').value.trim() || 'Relay ' + (COMMS.sats.length + 1), minEl = clamp(parseFloat($('satEl').value) || 0, 0, 90), rec;
  function n(id) { return parseFloat($(id).value); }
  if ($('satKind').value === 'kep') {
    var ep = Date.parse($('satEpoch').value + 'Z');
    rec = { kind: 'kep', name: name, r: [n('satX'), n('satY'), n('satZ')], v: [n('satVX'), n('satVY'), n('satVZ')], epoch: ep, frame: $('satFrame').value, minEl: minEl, on: true };
    if (!rec.r.concat(rec.v).every(isFinite)) { msg.textContent = 'Enter all six components: position X, Y, Z in km and velocity in km/s.'; return; }
    if (!isFinite(ep)) { msg.textContent = 'Enter the epoch.'; return; }
  } else {
    try { var H = parseHorizons($('satTab').value); rec = { kind: 'tab', name: name, t: H.t, p: H.p, v: H.v, note: H.note, minEl: minEl, on: true }; }
    catch (x) { msg.textContent = x.message; return; }
  }
  var s = satOf(rec); if (!s) { msg.textContent = rec.kind === 'kep' ? 'This state is not a closed orbit that stays above the 1737.4 km sphere (check units: km and km/s, Moon-centred).' : 'The table could not be used.'; return; }
  COMMS.sats.push(s); msg.textContent = 'Added ' + name + '.'; $('satName').value = ''; $('satTab').value = ''; $('satAdd').open = false; commsChanged();
});

// test hook (tests/check_comms.py)
window.LWB_COMMS_TEST = { parseHorizons: parseHorizons, satOf: satOf, satICRF: satICRF, satME: satME, clearOfMoon: clearOfMoon, state: function () { return { S: S, SITES: SITES, STEPS: STEPS, COMMS: COMMS }; } };
/* One sentence on what counts as a link, for the notes under the plots. */
function linkRuleText() {
  var t = 'The link is Earth\'s centre ' + (S.linkMin ? S.linkMin + '° or more above' : 'above') + ' the local skyline';
  if (S.ground) t += ', with a ticked ground antenna seeing the Moon';
  var n = satsOn().length;
  if (n) t += ', or ' + (n === 1 ? 'the relay satellite' : 'any of the ' + n + ' relay satellites') + ' in view with Earth in sight of it' + (S.ground ? ' and of an antenna' : '');
  return t + ' (as in the Site view).';
}
function linkWord() { return satsOn().length ? 'Link (direct or relay)' : 'Earth link'; }
function commsText() {
  var a = [];
  if (S.ground) { var on = stationsOn(); a.push(on.length ? 'a ground antenna (' + on.map(function (q) { return q.name; }).join(', ') + ') sees the Moon or the relay in use' : 'a ground antenna is required but none is ticked, so there is no link'); }
  satsOn().forEach(function (q) { a.push('relay ' + q.name + ' counts when it is ' + (q.minEl ? q.minEl + '° or more above' : 'above') + ' the local skyline and has Earth in view'); });
  return a;
}
