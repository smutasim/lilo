"""Add horizon masks at more observer heights to data/terrain.json, with the same code and inputs as
make_terrain.py (lolaterrain.horizon_mask; 5 m tile + 20 m mosaic + 240 m grid), so the page offers exact skylines
at 0, 2, 5, 10, 20, 50 and 100 m instead of interpolating. As a check, the 2 m mask is recomputed and must equal the
shipped one bin for bin.

Usage: .venv/Scripts/python tools/terrain/add_heights.py      (needs data/raw)
"""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402
from make_terrain import HOBS, b64, to_i16  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')


def main():
    tp = os.path.join(lt.ROOT, 'data', 'terrain.json')
    out = json.load(open(tp))
    sites = {s['id']: s for s in json.load(open(os.path.join(lt.ROOT, 'data', 'sites.json'), encoding='utf-8'))['sites'] if s.get('id')}
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    nan20 = np.full((2, 2), np.nan, dtype=np.float32)
    worst = 0
    for sid, rec in out['sites'].items():
        s = sites[sid]; t0 = time.time()
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        in20 = s['lat'] < -80.02
        tile = lt.load_tile(s['terrain_tile']) if s.get('terrain_tile') else lt.NO_TILE
        g20 = m20 if in20 else nan20
        # check: the 2 m mask reproduces the shipped one
        chk, _, _ = lt.horizon_mask(*tile, g20, m240, x, y, 2.0, lt.NB, in20, True)
        a = np.frombuffer(__import__('base64').b64decode(rec['mask']['2']), '<i2'); b = to_i16(chk)
        d = int(np.abs(a.astype(int) - b.astype(int)).max()); worst = max(worst, d)
        for hobs in HOBS:
            k = '%g' % hobs
            if k in rec['mask']:
                continue
            mask, _, _ = lt.horizon_mask(*tile, g20, m240, x, y, hobs, lt.NB, in20, True)
            rec['mask'][k] = b64(to_i16(mask))
        print('%-12s 2 m reproduced to %d x 0.01 deg; heights %s; %.0f s' % (sid, d, ','.join(sorted(rec['mask'], key=float)), time.time() - t0), flush=True)
    out['meta']['hobs_m'] = HOBS
    out['meta']['made_heights'] = time.strftime('%Y-%m-%d') + ' tools/terrain/add_heights.py'
    json.dump(out, open(tp, 'w'), separators=(',', ':'))
    print('worst 2 m difference from the shipped mask: %d x 0.01 deg -> %s' % (worst, 'PASS' if worst == 0 else 'CHECK'))


if __name__ == '__main__':
    main()
