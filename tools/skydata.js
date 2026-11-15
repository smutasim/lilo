// Build compact sky/earth data: bright stars, constellation lines, star names, Milky Way raster, Earth land mask.
const path = require('path');
const base = path.join(__dirname, '..', 'node_modules') + '/';
const fs = require('fs');
const stars = require(base + 'd3-celestial/data/stars.6.json');
const names = require(base + 'd3-celestial/data/starnames.json');
const lines = require(base + 'd3-celestial/data/constellations.lines.json');
const mw = require(base + 'd3-celestial/data/mw.json');
const topo = require(base + 'topojson-client');
const land110 = require(base + 'world-atlas/land-110m.json');

// stars: mag <= 5.8 -> flat array [ra*100, dec*100, mag*100, bv*100]
const S = [];
stars.features.filter(f => f.properties.mag <= 5.8).forEach(f => {
  let [ra, dec] = f.geometry.coordinates; if (ra < 0) ra += 360;
  S.push(Math.round(ra * 100), Math.round(dec * 100), Math.round(f.properties.mag * 100), Math.round((parseFloat(f.properties.bv) || 0.6) * 100));
});
// names for the brightest named stars (mag < 1.6)
const N = [];
stars.features.filter(f => f.properties.mag < 1.6 && names[f.id] && names[f.id].name).forEach(f => {
  let [ra, dec] = f.geometry.coordinates; if (ra < 0) ra += 360;
  N.push([names[f.id].name, +ra.toFixed(2), +dec.toFixed(2)]);
});
// constellation lines
const L = [];
lines.features.forEach(f => f.geometry.coordinates.forEach(seg => {
  L.push(seg.map(([ra, dec]) => [Math.round((ra < 0 ? ra + 360 : ra) * 10), Math.round(dec * 10)]));
}));

// even-odd scanline raster for rings in lon/lat degrees
function raster(polys, W, H, lonMin) {
  const g = new Uint8Array(W * H);
  polys.forEach(rings => {
    const cover = new Uint8Array(W * H);
    rings.forEach(ring0 => {
      // unwrap longitudes so the ring is continuous; a ring around a pole gets closed through that pole
      const ring = [[ring0[0][0], ring0[0][1]]];
      for (let k = 1; k < ring0.length; k++) {
        let dx = ring0[k][0] - ring0[k - 1][0];
        if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
        ring.push([ring[k - 1][0] + dx, ring0[k][1]]);
      }
      const net = ring[ring.length - 1][0] - ring[0][0];
      if (Math.abs(net) > 180) {
        // close every pole-encircling ring through the south pole; with even-odd, two such edges of a band XOR to the band
        const pole = -90;
        ring.push([ring[ring.length - 1][0], pole], [ring[0][0], pole], [ring[0][0], ring[0][1]]);
      } else if (ring[ring.length - 1][0] !== ring[0][0] || ring[ring.length - 1][1] !== ring[0][1]) {
        ring.push([ring[0][0], ring[0][1]]);
      }
      for (let j = 0; j < H; j++) {
        const lat = 90 - (j + 0.5) * 180 / H, xs = [];
        for (let k = 0; k < ring.length - 1; k++) {
          const [x1, y1] = ring[k], [x2, y2] = ring[k + 1];
          if ((y1 <= lat && y2 > lat) || (y2 <= lat && y1 > lat)) xs.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
        }
        xs.sort((a, b) => a - b);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const i0 = Math.ceil((xs[q] - lonMin) / 360 * W - 0.5), i1 = Math.floor((xs[q + 1] - lonMin) / 360 * W - 0.5);
          for (let i = i0; i <= i1; i++) { const ii = ((i % W) + W) % W; cover[j * W + ii] ^= 1; }
        }
      }
    });
    for (let i = 0; i < W * H; i++) g[i] += cover[i];
  });
  return g;
}
// Land: 720x360, lon -180..180
const landGeo = topo.feature(land110, land110.objects.land);
const polysL = [];
landGeo.features.forEach(f => {
  const geom = f.geometry;
  (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).forEach(p => polysL.push(p));
});
const LW = 720, LH = 360;
const lg = raster(polysL, LW, LH, -180);
const bits = Buffer.alloc(LW * LH / 8);
for (let i = 0; i < LW * LH; i++) if (lg[i] & 1 || lg[i] > 0) bits[i >> 3] |= 1 << (i & 7);
let landFrac = 0; for (let i = 0; i < LW * LH; i++) if (lg[i]) landFrac++;
console.log('land fraction (area-unweighted)', (landFrac / (LW * LH)).toFixed(3));

// Milky Way: RA -180..180 in source; raster 360x180 levels summed
const MW = 360, MH = 180;
const polysM = [];
mw.features.forEach(f => {
  const geom = f.geometry;
  (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).forEach(p => polysM.push(p));
});
const mg = raster(polysM, MW, MH, -180);
let mx = 0; for (const v of mg) mx = Math.max(mx, v);
console.log('mw max level', mx);
// rotate so column 0 = RA 0
const mg2 = new Uint8Array(MW * MH);
for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) { const ra = -180 + (i + 0.5); const col = Math.floor(((ra % 360) + 360) % 360); mg2[j * MW + col] = mg[j * MW + i]; }
// RLE bytes
const rle = [];
for (let i = 0; i < mg2.length;) { let v = mg2[i], n = 0; while (i < mg2.length && mg2[i] === v && n < 255) { i++; n++; } rle.push(v, n); }

// PGM previews for visual check
function pgm(path, arr, W, H, scale) { const hdr = Buffer.from(`P5 ${W} ${H} 255\n`); fs.writeFileSync(path, Buffer.concat([hdr, Buffer.from(arr.map(v => Math.min(255, v * scale)))])); }
pgm(process.argv[2] + '/land.pgm', Array.from(lg, v => v ? 1 : 0), LW, LH, 255);
pgm(process.argv[2] + '/mw.pgm', Array.from(mg2), MW, MH, Math.floor(255 / Math.max(1, mx)));

const out = { stars: S, names: N, lines: L, land: { w: LW, h: LH, b64: bits.toString('base64') }, mw: { w: MW, h: MH, max: mx, rle: Buffer.from(rle).toString('base64') } };
fs.writeFileSync(process.argv[2] + '/sky.json', JSON.stringify(out));
console.log('stars', S.length / 4, 'names', N.length, 'line segs', L.length, 'sky.json bytes', fs.statSync(process.argv[2] + '/sky.json').size, 'land b64', out.land.b64.length, 'mw rle b64', out.mw.rle.length);
