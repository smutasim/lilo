// Build dist/lunar-window-browser.html: one self-contained page.
// src/index.template.html + src/core.js + src/app/*.js (sorted, one closure) + data/*.json inlined.
// Optional: data/regions/<id>.json (fine landing-precision grids) become dist/regions/<id>.js, loaded on demand
// with a script tag so they also work when the page is opened from a file. The page works without them.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = f => JSON.stringify(JSON.parse(read(f))).replace(/<\//g, '<\\/');   // minified, safe inside <script>
const app = fs.readdirSync(path.join(root, 'src/app')).filter(f => f.endsWith('.js')).sort().map(f => '/* ---- ' + f + ' ---- */\n' + read('src/app/' + f)).join('\n');
let t = read('src/index.template.html');
const regDir = path.join(root, 'data/regions');
const regions = fs.existsSync(regDir) ? fs.readdirSync(regDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
// 3D terrain patches (tools/imagery/make_imagery.py): dist/terrain3d/<id>.js, loaded on demand like the regions
const t3dDir = path.join(root, 'data/terrain3d');
const t3d = fs.existsSync(t3dDir) ? fs.readdirSync(t3dDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
const parts = {
  __SKY__: json('data/sky.json'), __EPHEM__: json('data/ephem.json'),
  __TERRAIN__: json('data/terrain.json'), __SITES__: json('data/sites.json'), __POLAR__: json('data/polar.json'), __CLONES__: json('data/clones.json'),
  __SURVEY__: json('data/survey.json'), __REGIONS__: JSON.stringify(regions),
  __IMAGERY__: json('data/imagery.json'), __GLOBALIMG__: fs.existsSync(path.join(root, 'data/imagery_global.json')) ? json('data/imagery_global.json') : 'null', __T3D__: JSON.stringify(t3d),
  __CORE__: read('src/core.js'), __APP__: app
};
for (const k of Object.keys(parts)) { if (!t.includes(k)) throw new Error('placeholder missing: ' + k); t = t.replace(k, () => parts[k]); }
fs.mkdirSync(path.join(root, 'dist/regions'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/lunar-window-browser.html'), t);
let rb = 0;
for (const id of regions) { const s = 'window.LWB_REGION&&window.LWB_REGION(' + json('data/regions/' + id + '.json') + ');'; rb += s.length; fs.writeFileSync(path.join(root, 'dist/regions', id + '.js'), s); }
fs.mkdirSync(path.join(root, 'dist/terrain3d'), { recursive: true });
let tb = 0;
for (const id of t3d) { const s = 'window.LWB_T3D&&window.LWB_T3D(' + json('data/terrain3d/' + id + '.json') + ');'; tb += s.length; fs.writeFileSync(path.join(root, 'dist/terrain3d', id + '.js'), s); }
console.log('built dist/lunar-window-browser.html', (t.length / 1e6).toFixed(2), 'MB');
console.log('  dist/terrain3d: ' + t3d.length + ' patches, ' + (tb / 1e6).toFixed(2) + ' MB (loaded on demand)');
for (const k of Object.keys(parts)) console.log('  ' + k.padEnd(12), (parts[k].length / 1e3).toFixed(0).padStart(6), 'kB');
console.log('  dist/regions: ' + regions.length + ' grid files, ' + (rb / 1e6).toFixed(2) + ' MB (optional, loaded on demand)');
