"""Build data/terrain.json (horizon masks, heights, slopes, neighbourhood grids) and fill derived site coordinates.

Steps
  1. Sites in data/sites.json with "derive": "max_avgvisib_in_tile" get lat/lon from the brightest pixel of
     PGDA AVGVISIB_85S_060M_201608 inside their PGDA 5 m tile (written back to sites.json).
  2. Per site south of 60S: horizon masks at 2 m and 10 m observer height, 1440 azimuth bins, int16 0.01 deg;
     distance to the horizon point; ground height; slope from cubic B-spline gradients on the 5 m and 20 m grids.
       south of 80S: 5 m tile (if any) + 20 m mosaic + 240 m grid
       60S-80S:      240 m grid only (regional relief; flagged in the app)
  3. Per site inside the 20 m mosaic: a GRID_N x GRID_N neighbourhood at GRID_D metres, 2 m observer,
     720 bins. Masks are delta-coded along azimuth (int8, escape -128 + int16) and gzipped.

Usage: python tools/terrain/make_terrain.py [--no-grid] [--only id,id] [--resume]
"""
import argparse, base64, gzip, json, os, sys, time
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402

HOBS = [2.0, 10.0, 0.0, 5.0, 20.0, 50.0, 100.0]   # first height: the one the distances and the 3D view use
GRID_N, GRID_D, GRID_NB, GRID_HOBS = 21, 100.0, 720, 2.0


def derive_sites(sites):
    ref = tifffile.imread(os.path.join(lt.RAW, 'AVGVISIB_85S_060M_201608.TIF'))
    for s in sites:
        if s.get('derive') != 'max_avgvisib_in_tile':
            continue
        t, x0, y0, res = lt.load_tile(s['terrain_tile'])
        x1, y1 = x0 + t.shape[1] * res, y0 - t.shape[0] * res
        m = 500.0   # stay off the tile edge so the 5 m near field surrounds the point
        j0, j1 = int((x0 + m + 151740) / 60) + 1, int((x1 - m + 151740) / 60)
        i0, i1 = int((151740 - (y0 - m)) / 60) + 1, int((151740 - (y1 + m)) / 60)
        i0, j0 = max(i0, 0), max(j0, 0)
        sub = ref[i0:i1, j0:j1]
        k = np.unravel_index(np.argmax(sub), sub.shape)
        x, y = -151740 + (j0 + k[1] + 0.5) * 60, 151740 - (i0 + k[0] + 0.5) * 60
        lat, lon = lt.xy_to_ll(x, y)
        s['lat'], s['lon'] = round(float(lat), 4), round(float(lon), 4)
        s['derived_from_avgvisib'] = round(float(sub[k]) * 0.00004 * 100, 2)
        print('derived %-12s %-9s x=%8.0f y=%8.0f  lat %.4f lon %.4f  ref avg visibility %.2f %%' % (
            s['id'], s['terrain_tile'], x, y, s['lat'], s['lon'], s['derived_from_avgvisib']))


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def delta_code(masks_i16):
    """(n, nb) int16 -> bytes. Per mask: first value int16 LE, then nb-1 deltas as int8; a delta outside
    [-127, 127] is written as -128 followed by the absolute value as int16 LE."""
    out = bytearray()
    for m in masks_i16:
        out += int(m[0]).to_bytes(2, 'little', signed=True)
        for k in range(1, len(m)):
            d = int(m[k]) - int(m[k - 1])
            if -127 <= d <= 127:
                out += d.to_bytes(1, 'little', signed=True)
            else:
                out += (-128).to_bytes(1, 'little', signed=True) + int(m[k]).to_bytes(2, 'little', signed=True)
    return bytes(out)


def to_i16(mask_deg):
    return np.clip(np.round(np.asarray(mask_deg) * 100), -32000, 32000).astype('<i2')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-grid', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--resume', action='store_true', help='keep sites already in data/terrain.json')
    a = ap.parse_args()
    sp_ = os.path.join(lt.ROOT, 'data', 'sites.json')
    doc = json.load(open(sp_, encoding='utf-8'))
    sites = doc['sites']
    derive_sites(sites)
    json.dump(doc, open(sp_, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

    tp = os.path.join(lt.ROOT, 'data', 'terrain.json')
    only = [x for x in a.only.split(',') if x]
    out = json.load(open(tp)) if ((only or a.resume) and os.path.exists(tp)) else {'sites': {}}
    out['meta'] = {
        'frame': 'MOON_ME (DE421), sphere R = 1737.4 km', 'nb': lt.NB, 'unit': '0.01 deg, int16 LE',
        'bin': 'mask[k] is the horizon elevation at azimuth k*360/nb deg (clockwise from north), linear in between',
        'hobs_m': HOBS, 'dist_unit': '10 m, uint16 LE (for the first observer height)',
        'method': 'rays 0-55 km (bilinear, finest DEM) + 3D scatter of 20 m pixels 4-50 km and 240 m pixels 45-400 km',
        'dems': ['PGDA LOLA_5mpp <tile>_final_adj_5mpp_surf.tif (Barker et al. 2021)', 'PGDA LOLA_20mpp LDEM_80S_20MPP_ADJ.TIF', 'PDS LDEM_60S_240M.IMG'],
        'slope': 'gradient of the cubic B-spline approximant; 10 m central baseline on the 5 m grid, 40 m on the 20 m grid',
        'grid': {'n': GRID_N, 'spacing_m': GRID_D, 'nb': GRID_NB, 'hobs_m': GRID_HOBS,
                 'order': 'index = iy*n + ix; east = (ix-(n-1)/2)*spacing, north = (iy-(n-1)/2)*spacing',
                 'coding': 'gzip of: per mask int16 LE first value, then int8 deltas (escape -128 + int16 LE absolute)'},
        'made': time.strftime('%Y-%m-%d'),
    }
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    nan20 = np.full((2, 2), np.nan, dtype=np.float32)
    for s in sites:
        if s['lat'] > -60.5 or (only and s['id'] not in only):
            continue
        if a.resume and s['id'] in out['sites'] and ('grid' in out['sites'][s['id']] or s['lat'] > -80.02 or a.no_grid):
            continue
        t0 = time.time()
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        in20 = s['lat'] < -80.02
        tile = lt.load_tile(s['terrain_tile']) if s.get('terrain_tile') else lt.NO_TILE
        if s.get('terrain_tile'):
            assert not np.isnan(lt._bil(*tile, x, y)), s['id'] + ' is outside its tile'
        g20 = m20 if in20 else nan20
        rec = {'dem': ([] if tile is lt.NO_TILE else ['5 m']) + (['20 m'] if in20 else []) + ['240 m'], 'mask': {}}
        for hobs in HOBS:
            mask, dist, hg = lt.horizon_mask(*tile, g20, m240, x, y, hobs, lt.NB, in20, True)
            rec['mask']['%g' % hobs] = b64(to_i16(mask))
            if hobs == HOBS[0]:
                rec['dist'] = b64(np.clip(np.round(dist / 10), 0, 65535).astype('<u2'))
                rec['stats'] = {'min_deg': round(float(mask.min()), 2), 'max_deg': round(float(mask.max()), 2),
                                'max_dist_km': round(float(dist.max()) / 1000, 1)}
        rec['h_m'] = round(float(hg), 1)
        rec['slope'] = {}
        if tile is not lt.NO_TILE:
            rec['slope']['5m'] = round(float(lt.slope_bspline(*tile, x, y)), 1)
        if in20:
            rec['slope']['20m'] = round(float(lt.slope_bspline(m20, -304000.0, 304000.0, 20.0, x, y)), 1)
        if in20 and not a.no_grid:
            n = GRID_N
            gm = np.zeros((n * n, GRID_NB), dtype='<i2'); gh = []; gs = []
            for iy in range(n):
                for ix in range(n):
                    gx, gy = lt.offset_xy(x, y, (ix - (n - 1) / 2) * GRID_D, (iy - (n - 1) / 2) * GRID_D)
                    mk, _, h = lt.horizon_mask(*tile, g20, m240, gx, gy, GRID_HOBS, lt.NB, True, True)
                    # 0.25 deg -> 0.5 deg bins centred on the same azimuths, 1-2-1 weights
                    c = (np.roll(mk, 1) + 2 * mk + np.roll(mk, -1))[::2] / 4
                    gm[iy * n + ix] = to_i16(c)
                    gh.append(round(float(h), 1))
                    sl = lt.slope_bspline(*tile, gx, gy) if tile is not lt.NO_TILE else np.nan
                    if np.isnan(sl):
                        sl = lt.slope_bspline(m20, -304000.0, 304000.0, 20.0, gx, gy)
                    gs.append(round(float(sl), 1))
            raw = delta_code(gm)
            rec['grid'] = {'h': gh, 'slope': gs, 'slope_grid': '5 m' if tile is not lt.NO_TILE else '20 m',
                           'gz': base64.b64encode(gzip.compress(raw, 9)).decode()}
            print('   grid bytes: int16 %d, delta %d, gzip %d' % (gm.nbytes, len(raw), len(gzip.compress(raw, 9))))
        out['sites'][s['id']] = rec
        print('%-12s h=%7.1f m  dem=%s  horizon %.2f..%.2f deg, farthest horizon point %.0f km, slope %s  (%.0f s)' % (
            s['id'], rec['h_m'], '+'.join(rec['dem']), rec['stats']['min_deg'], rec['stats']['max_deg'], rec['stats']['max_dist_km'], rec['slope'], time.time() - t0))
        json.dump(out, open(tp, 'w'))
    print('wrote data/terrain.json', os.path.getsize(tp), 'bytes')


if __name__ == '__main__':
    main()
