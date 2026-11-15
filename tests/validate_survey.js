// Survey sanity check against an independent product: the share of time with any Sun at each survey point,
// from the page's own code over the whole precomputed ephemeris span, against the PGDA 18.6-year average
// visibility at the same pixel (the value stored with each survey point). Not like for like: the periods differ
// (the span here is shorter than one 18.6-year precession cycle) and PGDA's product has its own observer height
// and sampling. It is a check for gross errors (wrong point, wrong frame, flipped azimuth), not a calibration.
// Usage: node tests/validate_survey.js [every]   (default: every 6th point)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const A = require('astronomy-engine'), L = require('../src/core.js');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
L.init(rd('data/ephem.json'), A);
const sv = rd('data/survey.json'), P = sv.pts, masks = L.decodeMasks(new Uint8Array(zlib.gunzipSync(Buffer.from(sv.gz, 'base64'))), P.length, sv.meta.nb);
const every = +process.argv[2] || 6, er = L.ephRange(), days = Math.floor((er[1] - er[0]) / 86400e3) - 1, ser = L.series(er[0], days, 120);
const x = [], y = [];
for (let k = 0; k < P.length; k += every) { const p = P[k]; x.push(p[5]); y.push(L.metricsFrom(L.makeSite(p[0], p[1], p[2] + 2, masks[k], 2), ser, 0).litFrac * 100); }
const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
let sxy = 0, sxx = 0, syy = 0, d2 = 0; const diffs = [];
for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; d2 += (y[i] - x[i]) ** 2; diffs.push(Math.abs(y[i] - x[i])); }
diffs.sort((a, b) => a - b);
const out = { points: n, span_days: days, span: new Date(er[0]).toISOString().slice(0, 10) + ' to ' + new Date(er[1]).toISOString().slice(0, 10), step_min: 120, r: +(sxy / Math.sqrt(sxx * syy)).toFixed(4), mean_page_minus_pgda_pct: +(my - mx).toFixed(2), rms_diff_pct: +Math.sqrt(d2 / n).toFixed(2), median_abs_diff_pct: +diffs[n >> 1].toFixed(2), p95_abs_diff_pct: +diffs[Math.floor(n * 0.95)].toFixed(2), max_abs_diff_pct: +diffs[n - 1].toFixed(2) };
console.log(JSON.stringify(out, null, 1));
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'validate_survey.json'), JSON.stringify(out, null, 1));
