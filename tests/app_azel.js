// Print the app's Sun/Earth azimuth and elevation (src/core.js) for points read from stdin:
// {"points":[{"lat":..,"lon":..,"ms":..}]} -> [{"spice":{sunAz,sunEl,earthAz,earthEl}|null,"ae":{...}}]
// Used by tests/validate_horizons.py so the comparison is against the code the page runs.
const fs = require('fs'), path = require('path');
const A = require('astronomy-engine');
const L = require('../src/core.js');
const eph = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/ephem.json'), 'utf8'));
const inp = JSON.parse(fs.readFileSync(0, 'utf8'));
function run() {
  return inp.points.map(p => {
    const o = L.look(L.makeSite(p.lat, p.lon, 0, null, 0), p.ms);
    return { src: o.src, sunAz: o.sunAz, sunEl: o.sunEl, earthAz: o.earthAz, earthEl: o.earthEl };
  });
}
L.init(eph, A); const spice = run();
L.init(null, A); const ae = run();
console.log(JSON.stringify(inp.points.map((p, i) => ({ spice: spice[i].src === 'spice' ? spice[i] : null, ae: ae[i] }))));
