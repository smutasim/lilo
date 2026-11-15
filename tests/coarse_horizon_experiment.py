"""Why the page does not compute horizons from a coarse DEM in the browser.

Shipping a 240 m grid and computing a horizon for any point in the page would cover custom coordinates without
a helper. This script measures what that would cost: at each curated site south of 85S, the horizon from the
240 m grid alone is compared with the full-resolution mask (5 m + 20 m + 240 m), observer 2 m, and the share of
2027 with any Sun visible is computed from both.

Result (2026-11-10): errors of up to 52 percentage points, so the idea was
dropped in favour of tools/terrain/serve.py, which computes full-resolution masks on demand.

Usage: python tests/coarse_horizon_experiment.py     (needs data/raw)
"""
import base64, json, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'terrain'))
import lolaterrain as lt  # noqa: E402
import illum  # noqa: E402

m240 = lt.load_m240()[0]
nan20 = np.full((2, 2), np.nan, dtype=np.float32)
sites = {s['id']: s for s in json.load(open(os.path.join(ROOT, 'data', 'sites.json'), encoding='utf-8'))['sites']}
T = json.load(open(os.path.join(ROOT, 'data', 'terrain.json')))['sites']
ets, sun = illum.vectors('SUN', '2027-01-01T00:00:00', '2028-01-01T00:00:00', 3600.0)
print('site          mask, coarse minus full (deg): mean   rms   max | sunlit % of 2027: full  coarse  diff')
rows = []
for k, t in T.items():
    s = sites[k]
    if s['lat'] > -85:
        continue
    x, y = lt.ll_to_xy(s['lat'], s['lon'])
    full = np.frombuffer(base64.b64decode(t['mask']['2']), dtype='<i2') / 100
    mk, _, hg = lt.horizon_mask(*lt.NO_TILE, nan20, m240, x, y, 2.0, lt.NB, False, True)
    d = mk - full
    r = []
    for m, h in ((full, t['h_m']), (mk, hg)):
        az, el, rng = illum.az_el(sun, s['lat'], s['lon'], h + 2)
        r.append(float((illum.disk_fraction(m, az, el, np.degrees(np.arcsin(illum.R_SUN_KM / rng))) > 0).mean() * 100))
    rows.append({'id': k, 'mask_mean': float(d.mean()), 'mask_rms': float(np.sqrt((d ** 2).mean())), 'mask_max': float(np.abs(d).max()), 'lit_full': r[0], 'lit_coarse': r[1]})
    print('%-12s %+6.2f %5.2f %5.2f | %6.1f %6.1f %+6.1f' % (k, d.mean(), np.sqrt((d ** 2).mean()), np.abs(d).max(), r[0], r[1], r[1] - r[0]))
os.makedirs(os.path.join(ROOT, 'tests', 'out'), exist_ok=True)
json.dump(rows, open(os.path.join(ROOT, 'tests', 'out', 'coarse_horizon_experiment.json'), 'w'), indent=1)
