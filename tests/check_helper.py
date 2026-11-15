"""The terrain helper must reproduce the shipped masks: for every listed site south of 80 S, the record
tools/terrain/serve.py would return is compared with data/terrain.json (same code path, so the only possible
difference is which 5 m tile the helper picks where tiles overlap).  Usage: python tests/check_helper.py"""
import base64, json, os, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'terrain'))
import lolaterrain as lt, serve  # noqa: E402

serve.M20 = lt.load_m20()[0]; serve.M240 = lt.load_m240()[0]; serve.index_tiles()
sites = json.load(open(os.path.join(ROOT, 'data', 'sites.json'), encoding='utf-8'))['sites']
T = json.load(open(os.path.join(ROOT, 'data', 'terrain.json')))['sites']
worst, rows = 0.0, []
for s in sites:
    if s['lat'] > serve.LAT_LIMIT or s['id'] not in T:
        continue
    rec = serve.mask_record(s['lat'], s['lon'])
    d = 0.0
    for h in ('2', '10'):
        a = np.frombuffer(base64.b64decode(rec['mask'][h]), dtype='<i2').astype(float)
        b = np.frombuffer(base64.b64decode(T[s['id']]['mask'][h]), dtype='<i2').astype(float)
        d = max(d, float(np.abs(a - b).max()) / 100)
    same = rec['tile'] == s.get('terrain_tile')
    rows.append({'id': s['id'], 'helper_tile': rec['tile'], 'shipped_tile': s.get('terrain_tile'), 'max_diff_deg': d})
    if same:
        worst = max(worst, d)
    print('%-12s helper tile %-9s shipped tile %-9s max mask difference %.2f deg%s' % (s['id'], rec['tile'], s.get('terrain_tile'), d, '' if same else '  (different tile)'))
os.makedirs(os.path.join(ROOT, 'tests', 'out'), exist_ok=True)
json.dump(rows, open(os.path.join(ROOT, 'tests', 'out', 'check_helper.json'), 'w'), indent=1)
print('worst difference where the same tile is used: %.2f deg -> %s' % (worst, 'PASS' if worst == 0 else 'FAIL'))
if worst != 0:
    sys.exit(1)

# The helper's on-demand landing-precision grid must reproduce the prebuilt 50 m region grid (same function,
# so this guards the request path: row order, tile choice, encoding). One row at the first site that has a file.
import gzip
reg_dir = os.path.join(ROOT, 'data', 'regions')
for s in sites:
    f = os.path.join(reg_dir, s['id'] + '.json')
    if not os.path.exists(f) or not s.get('terrain_tile'):
        continue
    R = json.load(open(f)); n = R['n']; row = n // 2
    raw = gzip.decompress(base64.b64decode(R['gz'])); masks = []; p = 0
    for _ in range(n * n):
        v = int.from_bytes(raw[p:p + 2], 'little', signed=True); p += 2; a = [v]
        for _k in range(R['nb'] - 1):
            d = int.from_bytes(raw[p:p + 1], 'little', signed=True); p += 1
            if d == -128:
                v = int.from_bytes(raw[p:p + 2], 'little', signed=True); p += 2
            else:
                v += d
            a.append(v)
        masks.append(a)
    want = np.array(masks[row * n:(row + 1) * n])
    g = serve.grid_row(s['lat'], s['lon'], n, R['spacing_m'], row)
    got = np.frombuffer(base64.b64decode(g['masks']), dtype='<i2').reshape(n, R['nb'])
    dg = float(np.abs(got - want).max()) / 100
    print('grid row %d at %s: helper vs data/regions, max difference %.2f deg, heights equal: %s -> %s' % (row, s['id'], dg, g['h'] == R['h'][row * n:(row + 1) * n], 'PASS' if dg == 0 else 'FAIL'))
    if dg != 0:
        sys.exit(1)
    break
