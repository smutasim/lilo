"""Build data/regions/<id>.json: a fine horizon-mask grid around each listed south-polar site, for the
landing-precision map. Same method and coding as the neighbourhood grids in data/terrain.json
(make_terrain.py step 3), only denser: N x N nodes at D metres, 2 m observer, 720 azimuth bins.

The page loads these on demand (dist/regions/<id>.js) and falls back to the 100 m grid inside the page.

Usage: python tools/terrain/make_regions.py [--n 41] [--d 50] [--only id,id] [--resume]
"""
import argparse, base64, gzip, json, os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402
from make_terrain import delta_code, to_i16  # noqa: E402

HOBS, NBOUT = 2.0, 720


def grid_record(tile, m20, m240, x, y, n, d, rows=None):
    """Masks, heights and slopes for rows iy in `rows` (default all) of an n x n grid centred on (x, y)."""
    rows = range(n) if rows is None else rows
    gm = np.zeros((len(rows) * n, NBOUT), dtype='<i2'); gh = []; gs = []
    for r, iy in enumerate(rows):
        for ix in range(n):
            gx, gy = lt.offset_xy(x, y, (ix - (n - 1) / 2) * d, (iy - (n - 1) / 2) * d)
            mk, _, h = lt.horizon_mask(*tile, m20, m240, gx, gy, HOBS, lt.NB, True, True)
            gm[r * n + ix] = to_i16((np.roll(mk, 1) + 2 * mk + np.roll(mk, -1))[::2] / 4)
            gh.append(round(float(h), 1))
            sl = lt.slope_bspline(*tile, gx, gy) if tile is not lt.NO_TILE else np.nan
            if np.isnan(sl):
                sl = lt.slope_bspline(m20, -304000.0, 304000.0, 20.0, gx, gy)
            gs.append(round(float(sl), 1))
    return gm, gh, gs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=41)
    ap.add_argument('--d', type=float, default=50.0)
    ap.add_argument('--only', default='')
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    sites = json.load(open(os.path.join(lt.ROOT, 'data', 'sites.json'), encoding='utf-8'))['sites']
    only = [x for x in a.only.split(',') if x]
    out_dir = os.path.join(lt.ROOT, 'data', 'regions')
    os.makedirs(out_dir, exist_ok=True)
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    for s in sites:
        if s['lat'] > -80.02 or (only and s['id'] not in only):
            continue
        p = os.path.join(out_dir, s['id'] + '.json')
        if a.resume and os.path.exists(p):
            continue
        t0 = time.time()
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        tile = lt.load_tile(s['terrain_tile']) if s.get('terrain_tile') else lt.NO_TILE
        gm, gh, gs = grid_record(tile, m20, m240, float(x), float(y), a.n, a.d)
        rec = {'id': s['id'], 'lat': s['lat'], 'lon': s['lon'], 'n': a.n, 'spacing_m': a.d, 'nb': NBOUT, 'hobs_m': HOBS,
               'dem': ([] if tile is lt.NO_TILE else ['5 m']) + ['20 m', '240 m'],
               'slope_grid': '5 m' if tile is not lt.NO_TILE else '20 m', 'h': gh, 'slope': gs,
               'gz': base64.b64encode(gzip.compress(delta_code(gm), 9)).decode(), 'made': time.strftime('%Y-%m-%d')}
        json.dump(rec, open(p, 'w'))
        print('%-12s %d x %d at %g m  %d bytes  %.0f s' % (s['id'], a.n, a.n, a.d, os.path.getsize(p), time.time() - t0), flush=True)


if __name__ == '__main__':
    main()
