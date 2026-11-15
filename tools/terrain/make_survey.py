"""Build data/survey.json: one full-resolution horizon mask per cell of the south polar cap, for the finder.

Candidate rule (a selection rule, not a physical model): the PGDA AVGVISIB_85S_060M_201608 map (18.6-year
average solar visibility, 60 m/px, +-151.74 km) is cut into CELL_PX x CELL_PX pixel cells; each cell
contributes the centre of its brightest pixel. The map value is used only to choose where to look. Every
number the page reports for a survey point comes from the horizon mask computed here with
lolaterrain.horizon_mask (5 m tile where one surrounds the point, 20 m mosaic, 240 m grid), the same code
that builds data/terrain.json.

Per point: lat, lon, ground height, slope (20 m grid, 40 m baseline; and 5 m grid where a tile is used),
the reference map value, and a 720-bin mask at 2 m observer height (1-2-1 from 1440 bins, as the grids).

Usage: python tools/terrain/make_survey.py [--cell-px 84] [--limit N]
"""
import argparse, base64, glob, gzip, json, os, sys, time
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402
from make_terrain import delta_code, to_i16  # noqa: E402

HOBS, NBOUT = 2.0, 720
AV_HALF, AV_PX, AV_SCALE = 151740.0, 60.0, 0.00004


def tiles_index():
    out = []
    for p in sorted(glob.glob(os.path.join(lt.RAW, '*_final_adj_5mpp_surf.tif'))):
        with tifffile.TiffFile(p) as t:
            pg = t.pages[0]
            tie = pg.tags['ModelTiepointTag'].value
            h, w = pg.shape
            out.append((os.path.basename(p).split('_final')[0], tie[3], tie[4], tie[3] + w * 5.0, tie[4] - h * 5.0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cell-px', type=int, default=84)
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    av = tifffile.imread(os.path.join(lt.RAW, 'AVGVISIB_85S_060M_201608.TIF'))
    n = av.shape[0]
    c = a.cell_px
    nc = n // c
    o = (n - nc * c) // 2
    tiles = tiles_index()
    pts = []
    for bi in range(nc):
        for bj in range(nc):
            sub = av[o + bi * c:o + (bi + 1) * c, o + bj * c:o + (bj + 1) * c]
            if sub.max() < 0:
                continue
            k = np.unravel_index(np.argmax(sub), sub.shape)
            x = -AV_HALF + (o + bj * c + k[1] + 0.5) * AV_PX
            y = AV_HALF - (o + bi * c + k[0] + 0.5) * AV_PX
            name = None
            for nm, x0, y0, x1, y1 in tiles:
                if x0 + 500 < x < x1 - 500 and y1 + 500 < y < y0 - 500:
                    name = nm
                    break
            pts.append((name or '', x, y, float(sub[k]) * AV_SCALE * 100))
    pts.sort(key=lambda p: p[0])       # group by tile so each tile loads once
    if a.limit:
        pts = pts[:: max(1, len(pts) // a.limit)]
    print('%d cells of %.2f km, %d candidate points' % (nc * nc, c * AV_PX / 1000, len(pts)), flush=True)
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    cur, tile = None, lt.NO_TILE
    masks = np.zeros((len(pts), NBOUT), dtype='<i2')
    rows = []
    t0 = time.time()
    for i, (name, x, y, ref) in enumerate(pts):
        if name != cur:
            cur = name
            tile = lt.load_tile(name) if name else lt.NO_TILE
        use = tile
        if name and np.isnan(lt._bil(*tile, x, y)):
            use, name = lt.NO_TILE, ''
        mk, _, h = lt.horizon_mask(*use, m20, m240, x, y, HOBS, lt.NB, True, True)
        masks[i] = to_i16((np.roll(mk, 1) + 2 * mk + np.roll(mk, -1))[::2] / 4)
        lat, lon = lt.xy_to_ll(x, y)
        s20 = float(lt.slope_bspline(m20, -304000.0, 304000.0, 20.0, x, y))
        s5 = float(lt.slope_bspline(*use, x, y)) if name else float('nan')
        rows.append([round(float(lat), 5), round(float(lon), 4), round(float(h), 1), round(s20, 1),
                     None if np.isnan(s5) else round(s5, 1), round(ref, 2), name or None])
        if i % 100 == 0:
            print('%5d / %d  %.0f s' % (i, len(pts), time.time() - t0), flush=True)
    raw = delta_code(masks)
    out = {'meta': {'rule': 'brightest pixel of PGDA AVGVISIB_85S_060M_201608 in each %d x %d pixel cell (%.2f km); the map only chooses the point' % (c, c, c * AV_PX / 1000),
                    'cell_km': c * AV_PX / 1000, 'nb': NBOUT, 'hobs_m': HOBS,
                    'cols': ['lat', 'lon', 'h_m', 'slope20_deg', 'slope5_deg', 'ref_avgvis_pct', 'tile'],
                    'method': 'lolaterrain.horizon_mask: rays 0-55 km on the finest DEM + scatter of 20 m and 240 m pixels to 400 km; 1440 bins reduced 1-2-1 to 720',
                    'coding': 'gzip of delta-coded int16 masks (see data/terrain.json meta.grid.coding)', 'made': time.strftime('%Y-%m-%d')},
           'pts': rows, 'gz': base64.b64encode(gzip.compress(raw, 9)).decode()}
    p = os.path.join(lt.ROOT, 'data', 'survey.json')
    json.dump(out, open(p, 'w'))
    print('wrote data/survey.json %d bytes, %d points, %.0f s' % (os.path.getsize(p), len(pts), time.time() - t0), flush=True)


if __name__ == '__main__':
    main()
