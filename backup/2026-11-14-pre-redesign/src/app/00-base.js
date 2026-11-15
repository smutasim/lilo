var BOOT_T0 = performance.now();
var D2R = Math.PI / 180, R2D = 180 / Math.PI, RM = LWB.RM, RE = 6371, AU = LWB.AU;
// Sun/Earth geometry is sampled every 10 min so short polar events are bracketed; edges are then root-found.
// Ground-station visibility is evaluated every third step (30 min) and held.
var STEP_MIN = 10, PER_DAY = 144, DSN_EVERY = 3, EXTRA_D = 46, STEP_MS = STEP_MIN * 60000, EPOCH0 = Date.UTC(2026, 0, 1), DAY = 86400000;
function $(id) { return document.getElementById(id); }
function fail(msg) { var e = $('err'); e.hidden = false; e.textContent = msg; }
if (typeof Astronomy === 'undefined') { fail('The astronomy library did not load, so the sky cannot be drawn. Check the connection and reload.'); return; }
var SKY, EPHEM, TERRAIN, SITEDATA, POLAR, CLONES, SURVEY, REGION_IDS = [], IMAGERY = null, GLOBALIMG = null, T3D_IDS = [];
try {
  SKY = JSON.parse($('skydata').textContent);
  EPHEM = JSON.parse($('ephemdata').textContent); TERRAIN = JSON.parse($('terraindata').textContent);
  SITEDATA = JSON.parse($('sitedata').textContent); POLAR = JSON.parse($('polardata').textContent);
  CLONES = JSON.parse($('clonedata').textContent); SURVEY = JSON.parse($('surveydata').textContent);
  REGION_IDS = JSON.parse($('regiondata').textContent);
  IMAGERY = JSON.parse($('imagerydata').textContent); T3D_IDS = JSON.parse($('t3ddata').textContent);
  GLOBALIMG = JSON.parse($('globalimgdata').textContent);
} catch (x) { fail('Built-in data could not be read.'); return; }
LWB.init(EPHEM, Astronomy);

/* ================= vectors ================= */
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function unit(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function addS(a, b, s) { return [a[0]+b[0]*s, a[1]+b[1]*s, a[2]+b[2]*s]; }
function scl(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ================= frames (astronomy-engine; used for the star field, Earth texture and ground stations) ================= */
function frame(ms) {
  var time = Astronomy.MakeTime(new Date(ms));
  var ax = LWB.aeAxes(time);
  var m = Astronomy.GeoMoonState(time);
  var r = [m.x, m.y, m.z], v = [m.vx, m.vy, m.vz];
  var s = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
  var dAU = Math.hypot(r[0], r[1], r[2]);
  var xr = unit(r), zr = unit(cross(r, v));
  return {
    ms: ms, time: time, ax: ax,
    toSun: unit([s.x - r[0], s.y - r[1], s.z - r[2]]),
    toEarth: [-r[0]/dAU, -r[1]/dAU, -r[2]/dAU],
    dist: dAU * AU, moonKm: scl(r, AU), sunGeoU: unit([s.x, s.y, s.z]),
    xr: xr, yr: cross(zr, xr), zr: zr
  };
}
function toBF(f, v) { return [dot(v, f.ax.x), dot(v, f.ax.y), dot(v, f.ax.z)]; }
function fromBF(f, b) { var a = f.ax; return [b[0]*a.x[0]+b[1]*a.y[0]+b[2]*a.z[0], b[0]*a.x[1]+b[1]*a.y[1]+b[2]*a.z[1], b[0]*a.x[2]+b[1]*a.y[2]+b[2]*a.z[2]]; }
function earthRot(time) {
  var rot = Astronomy.Rotation_EQJ_EQD(time);
  function im(x, y, z) { var v = Astronomy.RotateVector(rot, new Astronomy.Vector(x, y, z, time)); return [v.x, v.y, v.z]; }
  return { ex: im(1, 0, 0), ey: im(0, 1, 0), ez: im(0, 0, 1), gast: Astronomy.SiderealTime(time) * 15 };
}

/* Deep Space Network 70 m antennas. Geodetic coordinates (WGS 84) from DSN 810-005, Module 301 "Coverage and
   Geometry", Rev. N, Table 5, as degrees, minutes, seconds and height in metres. The same module gives the
   generic elevation limits used for coverage: 6.0 deg receive, 10.0 deg low-power transmit. A two-way link
   needs the transmit limit, so DSN_EL is 10.0. */
function dms(d, m, s) { return (d < 0 ? -1 : 1) * (Math.abs(d) + m / 60 + s / 3600); }
var DSN_EL = 10.0, DSN_SRC = 'DSN 810-005, Module 301, Rev. N';
var DSN = [
  { name: 'Goldstone DSS-14', obs: new Astronomy.Observer(dms(35, 25, 33.24312), dms(243, 6, 37.66244) - 360, 1001.390) },
  { name: 'Canberra DSS-43', obs: new Astronomy.Observer(dms(-35, 24, 8.72724), dms(148, 58, 52.56231), 688.867) },
  { name: 'Madrid DSS-63', obs: new Astronomy.Observer(dms(40, 25, 52.35510), dms(355, 45, 7.16924) - 360, 864.816) }
];

/* ================= sites and state ================= */
var CATS = [['polar', 'South pole'], ['clps', 'CLPS landers'], ['international', 'Other nations'], ['apollo', 'Apollo'], ['custom', 'Your sites']];
var SITES = [];
var today = new Date();
/* Limits are the user's own. The defaults claim nothing about any lander: Sun counts when any part of its disk
   is visible, Earth when its centre is above the local skyline, and nothing else is required. */
var S = {
  startMs: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  spanD: 60, horizonD: 30,
  sunFracMin: 0, sunMin: null, sunMax: null, linkMin: 0, needD: 0, ground: false,
  hobs: 2, N: 0, sel: 0, tMs: 0, playing: false, speed: 6,
  opt: { lines: false, names: false, grid: false },
  pins: [], tab: 'compare', view: 'site', skyMode: 'sky'
};
var STEPS = null, HELPER = { ok: false, url: 'http://127.0.0.1:8791' };
var cam = { yaw: 90, pitch: 18, hfov: 80 };
function sunOK(f) { return S.sunFracMin > 0 ? f >= S.sunFracMin - 1e-9 : f > 0; }

function loadCustom() {
  try { var raw = localStorage.getItem('lwb.sites.v2'); return raw ? JSON.parse(raw) : []; } catch (x) { return []; }
}
function saveCustom() {
  try { localStorage.setItem('lwb.sites.v2', JSON.stringify(SITES.filter(function (s) { return s.custom; }).map(function (s) { return { name: s.name, lat: s.lat, lon: s.lon, terr: s.terr ? { dem: s.terr.dem, mask: s.terr.mask, dist: s.terr.dist, stats: s.terr.stats, h_m: s.terr.h_m, slope: s.terr.slope, from: s.terr.from } : null }; }))); } catch (x) {}
}
/* A site's horizon: the LOLA mask for the chosen observer height where one exists (else the height that does),
   or a smooth sphere with the observer hobs above it. */
function maskHeight(s) { var t = s.terr; if (!t) return null; return t.mask[String(S.hobs)] ? S.hobs : +Object.keys(t.mask)[0]; }
function applyHorizon(s) {
  var t = s.terr, h = maskHeight(s);
  if (t) {
    if (!t.dec) t.dec = {};
    if (!t.dec[h]) t.dec[h] = LWB.b64i16(t.mask[String(h)]);
    LWB.setHorizon(s.geo, t.h_m + h, t.dec[h], h);
  } else LWB.setHorizon(s.geo, S.hobs, null, S.hobs);
  s.band = null; s.unc = null; s.year = null;
}
function makeSite(o, custom) {
  var lon = ((+o.lon + 540) % 360) - 180;
  var s = { id: o.id || null, name: o.name, lat: +o.lat, lon: lon, custom: !!custom, cat: custom ? 'custom' : o.category, src: o.source || '', url: o.source_url || '', note: o.note || '' };
  s.terr = custom ? (o.terr || null) : ((s.id && TERRAIN.sites[s.id]) || null);
  s.geo = LWB.makeSite(s.lat, s.lon, 0, null, 0);
  s.u = s.geo.u; s.e = s.geo.e; s.n = s.geo.n;
  applyHorizon(s);
  s.seed = Math.abs(Math.round(s.lat * 1000) * 7919 + Math.round(s.lon * 1000) * 104729) % 2147483647 || 7;
  return s;
}
SITEDATA.sites.forEach(function (o) { SITES.push(makeSite(o, false)); });
loadCustom().forEach(function (o) { if (isFinite(o.lat) && isFinite(o.lon)) SITES.push(makeSite(o, true)); });
function terrLabel(s) {
  if (!s.terr) return 'none (smooth sphere)';
  return 'LOLA ' + s.terr.dem.join(' + ') + (s.terr.from ? ' (' + s.terr.from + ')' : '');
}
/* Near the pole a smooth sphere is not a usable horizon: the page says so instead of reporting windows. */
function noTerrainPolar(s) { return !s.terr && Math.abs(s.lat) >= 80; }
function gunzipB64(b64) {
  if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
  var stream = new Blob([LWB.b64bytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
}
function i16b64(a) { var u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

/* ================= formatting ================= */
function pad(n) { return (n < 10 ? '0' : '') + n; }
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDay(ms) { var d = new Date(ms); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
function fmtDT(ms) { var d = new Date(Math.round(ms / 60000) * 60000); return fmtDay(d.getTime()) + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; }
function fmtFull(ms) { var d = new Date(ms); return d.getUTCFullYear() + ' ' + fmtDay(ms) + '  ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; }
function iso(ms) { return new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16) + 'Z'; }
function fmtCoord(lat, lon) { var p = Math.abs(lat) > 80 ? 3 : 2; return Math.abs(lat).toFixed(p) + '°' + (lat < 0 ? 'S' : 'N') + '  ' + Math.abs(lon).toFixed(p) + '°' + (lon < 0 ? 'W' : 'E'); }
function fmtDur(steps) { var h = steps * STEP_MIN / 60; return h < 48 ? Math.round(h) + ' h' : (h / 24).toFixed(1) + ' days'; }
/* A time span to the minute: "3 d 4 h 12 min". */
function fmtSpan(ms) {
  var m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return (d ? d + ' d ' : '') + (d || h ? h + ' h ' : '') + mm + ' min';
}
function fmtHours(h) { return h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : (h / 24).toFixed(1) + ' d'; }
function deg(v) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1) + '°'; }
function deg2(v) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '°'; }
function pct(f) { return (f > 0 && f < 0.01 ? '<1' : f < 1 && f > 0.99 ? '>99' : Math.round(f * 100)) + '%'; }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function stepMs(i) { return S.startMs + i * STEP_MS; }
function stepOf(ms) { return clamp(Math.round((ms - S.startMs) / STEP_MS), 0, S.N - 1); }
var COMPASS = ['N','NE','E','SE','S','SW','W','NW'];
function compass16(az) { return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(az / 22.5) % 16]; }
