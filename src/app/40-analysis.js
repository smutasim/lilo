/* ================= shared helpers: slope, irradiance text, neighbourhood grid, colour ramp ================= */
function slopeText(s) { var t = s.terr; if (!t || !t.slope) return 'n/a'; return t.slope['5m'] !== undefined ? t.slope['5m'].toFixed(1) + '°' : t.slope['20m'] !== undefined ? t.slope['20m'].toFixed(1) + '°' : 'n/a'; }
function slopeVal(s) { var t = s.terr; if (!t || !t.slope) return NaN; return t.slope['5m'] !== undefined ? t.slope['5m'] : t.slope['20m'] !== undefined ? t.slope['20m'] : NaN; }
function wm2(v) { return Math.round(v).toLocaleString('en-US') + ' W/m²'; }

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

/* ---------- colour ramp for the candidate map ---------- */
function ramp(u) { // dark blue -> teal -> yellow
  u = clamp(u, 0, 1);
  var r = u < 0.5 ? 40 + 40 * u : 60 + 380 * (u - 0.5), g = 60 + 170 * u, b = u < 0.5 ? 120 + 60 * u : 150 - 220 * (u - 0.5);
  return 'rgb(' + Math.round(clamp(r, 0, 255)) + ',' + Math.round(clamp(g, 0, 255)) + ',' + Math.round(clamp(b, 0, 255)) + ')';
}
