"""Horizon masks on PGDA DEM-error clones -> data/clones.json (DEM uncertainty for the headline numbers).

Barker et al. 2021 (Planet. Space Sci. 203, 105119) publish 100 "clones" of each 5 m site LDEM: realisations
of the same surface with orbital and interpolation errors re-drawn (.../LOLA_5mpp/<Site>/Clones/
<Site>_final_adj_5mpp_NNNN_err.tif). Recomputing the horizon on each clone and looking at the spread of the
result is the method that paper uses for illumination uncertainty. Here the near field (the tile) is replaced
by each clone; the 20 m and 240 m far field is unchanged, as in the paper.

Only sites with a 5 m tile get clone masks. Clones 1..N are used (N = --n, default 16); each file is
downloaded, used, and deleted. Masks: both observer heights, the same 1440 bins as the site masks, coded like
the neighbourhood grids.

Usage: python tools/terrain/make_clone_masks.py [--n 16] [--only id,id]
"""
import argparse, base64, gzip, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402
from make_terrain import HOBS, delta_code, to_i16  # noqa: E402

URL = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/%s/Clones/%s_final_adj_5mpp_%04d_err.tif'
CDIR = os.path.join(lt.RAW, 'clones')


def fetch(tile, k):
    p = os.path.join(CDIR, '%s_%04d.tif' % (tile, k))
    if not os.path.exists(p):
        urllib.request.urlretrieve(URL % (tile, tile, k), p + '.part')
        os.replace(p + '.part', p)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=16)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(CDIR, exist_ok=True)
    sites = json.load(open(os.path.join(lt.ROOT, 'data', 'sites.json'), encoding='utf-8'))['sites']
    op = os.path.join(lt.ROOT, 'data', 'clones.json')
    out = json.load(open(op)) if os.path.exists(op) else {'sites': {}}
    out['meta'] = {'n': a.n, 'nb': lt.NB, 'hobs_m': HOBS, 'clones': 'PGDA LOLA_5mpp <Site>/Clones/*_NNNN_err.tif, NNNN = 0001..%04d' % a.n,
                   'method': 'near field replaced by each clone; far field unchanged (Barker et al. 2021)',
                   'coding': 'per observer height: gzip of delta-coded int16 masks (0.01 deg), n masks of nb bins', 'made': time.strftime('%Y-%m-%d')}
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    only = [x for x in a.only.split(',') if x]
    for s in sites:
        tile = s.get('terrain_tile')
        if not tile or (only and s['id'] not in only) or (s['id'] in out['sites'] and out['sites'][s['id']].get('n') == a.n and out['sites'][s['id']].get('nb') == lt.NB):
            continue
        t0 = time.time()
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        _, tx0, ty0, tres = lt.load_tile(tile)
        masks = {h: np.zeros((a.n, lt.NB), dtype='<i2') for h in HOBS}
        hg = []
        with ThreadPoolExecutor(4) as ex:
            for k, p in enumerate(ex.map(lambda q: fetch(tile, q), range(1, a.n + 1))):
                arr = np.ascontiguousarray(tifffile.imread(p), dtype=np.float32)
                for h in HOBS:
                    mk, _, g = lt.horizon_mask(arr, tx0, ty0, tres, m20, m240, x, y, h, lt.NB, True, True)
                    masks[h][k] = to_i16(mk)
                hg.append(round(float(g), 2))
                os.remove(p)
        out['sites'][s['id']] = {'n': a.n, 'nb': lt.NB, 'h_m': hg, 'mask': {'%g' % h: base64.b64encode(gzip.compress(delta_code(masks[h]), 9)).decode() for h in HOBS}}
        json.dump(out, open(op, 'w'))
        print('%-12s %d clones, ground height %.2f..%.2f m  (%.0f s)' % (s['id'], a.n, min(hg), max(hg), time.time() - t0), flush=True)
    print('wrote data/clones.json', os.path.getsize(op), 'bytes')


if __name__ == '__main__':
    main()
