"""Validate terrain illumination against published LOLA results.

A. Barker et al. 2021 (PSS 203, 105119), Table 2: Site 1 (Shackleton - de Gerlache connecting ridge),
   RoI centroids given as stereographic X/Y. Average visible fraction of the Sun's disk, hourly,
   2024-01-01 to 2026-01-01, at 1 m and 5 m above the surface, with the same 5 m LDEM used here.
   The table lists the 1st percentile over 100 error clones (case A, RoI-averaged), so it is a lower
   bound for the nominal value; by construction each RoI has nominal average illumination > 70 % at 1 m.

B. PGDA / PDS AVGVISIB_85S_060M_201608 (Mazarico et al. 2011 method): fraction of hourly time steps over
   18.6 years with any part of the solar disk visible, at the surface, from the 60 m LDEM.
   B1 (the test): a regular 10 x 10 lattice of reference pixel centres, 300 m apart, in two regions. Ours is
      computed at the surface with the near field block-averaged from the 20 m mosaic onto the reference's
      60 m pixel grid. A lattice avoids selection bias; statistics are mean difference, RMS and correlation.
   B2 (context): the curated sites, which were chosen as the brightest reference pixel in each tile. Picking
      the maximum of a noisy map biases the reference high at that pixel, and a surface point is extremely
      sensitive to its immediate neighbours, so these rows are informative only. Ours is shown at 2 m.

Usage: python tests/validate_illumination.py
"""
import os, sys, json
import numpy as np
import tifffile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'terrain'))
import lolaterrain as lt  # noqa: E402
import illum  # noqa: E402

ROI_XY = [(-11.5825, -12.4625), (-11.4875, -12.5575), (-11.3525, -12.5025), (-11.2875, -12.1675),
          (-11.1025, -11.9425), (-10.8025, -11.7375), (-10.2275, -11.5525)]
BARKER = {1: [68.03, 70.32, 67.51, 69.61, 70.38, 71.15, 67.36],     # Avg Ill-1, case A, dz = 1 m
          5: [89.26, 88.51, 84.53, 88.12, 85.71, 87.35, 82.79]}     # dz = 5 m


def coarse_window(m20, xo, yo, half=6000.0, f=3):
    """Block-average the 20 m mosaic onto the reference's 60 m pixel grid (edges at -151740 + 60 k) in a
    window around (xo, yo); returns a 'tile' tuple."""
    j0 = int((xo - half + 304000) / 20) // f * f + 2; i0 = int((304000 - (yo + half)) / 20) // f * f + 2
    assert (-304000 + j0 * 20 + 151740) % 60 == 0 and (304000 - i0 * 20 - 151740) % 60 == 0
    n = int(2 * half / 20) // f * f
    w = m20[i0:i0 + n, j0:j0 + n].reshape(n // f, f, n // f, f).mean(axis=(1, 3)).astype(np.float32)
    return w, -304000.0 + j0 * 20.0, 304000.0 - i0 * 20.0, 20.0 * f


def lit_share(tl, m20, m240, x, y, hobs, sun):
    lat, lon = lt.xy_to_ll(x, y)
    mask, dist, hg = lt.horizon_mask(*tl, m20, m240, x, y, hobs, lt.NB, True, True)
    az, el, rng = illum.az_el(sun, lat, lon, hg + hobs)
    fr = illum.disk_fraction(mask, az, el, np.degrees(np.arcsin(illum.R_SUN_KM / rng)))
    return float((fr > 0).mean() * 100)


def main():
    m20 = lt.load_m20()[0]; m240 = lt.load_m240()[0]
    tile = lt.load_tile('Site01')
    out = {'barker2021': [], 'avgvisib': []}

    # ---------------- A
    ets, sun = illum.vectors('SUN', '2024-01-01T00:00:00', '2026-01-01T00:00:00', 3600.0)
    print('A. Barker et al. 2021 Table 2, Site 1 RoI centroids, 2024-2026 hourly, visible disk fraction')
    print('   RoI   lat       lon      | 1 m: ours  Barker p1 (nominal > 70) | 5 m: ours  Barker p1 | LCIP d (1 m, 5 m)')
    for r, (xk, yk) in enumerate(ROI_XY):
        x, y = xk * 1000, yk * 1000
        lat, lon = lt.xy_to_ll(x, y)
        row = {'roi': r + 1, 'lat': float(lat), 'lon': float(lon)}
        for dz in (1, 5):
            mask, dist, hg = lt.horizon_mask(*tile, m20, m240, x, y, float(dz), lt.NB, True, True)
            az, el, rng = illum.az_el(sun, lat, lon, hg + dz)
            fr = illum.disk_fraction(mask, az, el, np.degrees(np.arcsin(illum.R_SUN_KM / rng)))
            row['avg%d' % dz] = float(fr.mean() * 100); row['lcip%d' % dz] = illum.longest_run(fr > 0, 1.0)
            row['barker_p1_%d' % dz] = BARKER[dz][r]
        out['barker2021'].append(row)
        print('   %d   %.4f  %.4f | %6.2f   %6.2f                  | %6.2f   %6.2f    | %5.1f %5.1f' % (
            r + 1, lat, lon, row['avg1'], row['barker_p1_1'], row['avg5'], row['barker_p1_5'], row['lcip1'], row['lcip5']))
    d5 = [r['avg5'] - r['barker_p1_5'] for r in out['barker2021']]
    print('   5 m: ours minus Barker 1st percentile: mean %+.2f, range %+.2f .. %+.2f percentage points' % (np.mean(d5), min(d5), max(d5)))

    # ---------------- B
    ref = tifffile.imread(os.path.join(lt.RAW, 'AVGVISIB_85S_060M_201608.TIF'))
    sp_ = os.path.join(ROOT, 'data', 'sites.json')
    sites = json.load(open(sp_, encoding='utf-8'))['sites'] if os.path.exists(sp_) else []
    pts = [s for s in sites if s.get('derived_from_avgvisib')]
    ets, sun = illum.vectors('SUN', '2010-01-01T00:00:00', '2028-08-08T00:00:00', 3600.0)   # 18.6 years
    print('B1. PGDA AVGVISIB_85S_060M_201608 on a 10 x 10 lattice (300 m), surface, 18.6 yr hourly, any part of the Sun visible')
    out['avgvisib_lattice'] = []
    for name, cx, cy in (('connecting ridge (Site01 tile centre)', -11000.0, -12000.0), ('Malapert massif (Site23 tile centre)', -500.0, 121500.0)):
        ours, refs = [], []
        i0, j0 = int((151740 - cy) / 60), int((cx + 151740) / 60)
        for a in range(-5, 5):
            for b in range(-5, 5):
                i, j = i0 + a * 5, j0 + b * 5
                x, y = -151740 + (j + 0.5) * 60, 151740 - (i + 0.5) * 60
                refs.append(ref[i, j] * 0.00004 * 100)
                ours.append(lit_share(coarse_window(m20, x, y), m20, m240, x, y, 0.0, sun))
        ours, refs = np.array(ours), np.array(refs)
        d = ours - refs
        row = {'region': name, 'n': len(d), 'ref_mean': float(refs.mean()), 'ours_mean': float(ours.mean()), 'mean_diff': float(d.mean()),
               'rms_diff': float(np.sqrt((d ** 2).mean())), 'median_abs_diff': float(np.median(np.abs(d))), 'r': float(np.corrcoef(ours, refs)[0, 1])}
        out['avgvisib_lattice'].append(row)
        print('   %-40s n=%d  ref mean %.1f %%  ours mean %.1f %%  mean diff %+.2f  median |diff| %.2f  RMS %.2f points  r = %.3f' % (
            name, row['n'], row['ref_mean'], row['ours_mean'], row['mean_diff'], row['median_abs_diff'], row['rms_diff'], row['r']))
    print('B2. curated sites (brightest reference pixel per tile; context only)')
    print('   site                               ref % (surface, 60 m)   ours % (2 m, full resolution)')
    for s in pts:
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        i, j = int((151740 - y) / 60), int((x + 151740) / 60)
        refv = ref[i, j] * 0.00004 * 100
        v2 = lit_share(lt.load_tile(s['terrain_tile']), m20, m240, x, y, 2.0, sun)
        out['avgvisib'].append({'id': s['id'], 'ref': float(refv), 'ours_2m': v2})
        print('   %-34s %6.2f                  %6.2f' % (s['name'][:34], refv, v2))
    os.makedirs(os.path.join(ROOT, 'tests', 'out'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'tests', 'out', 'validate_illumination.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
