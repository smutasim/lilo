"""Precompute Sun and Earth as seen from the Moon's centre, in MOON_ME, with SPICE.

Output: data/ephem.json  (meta + base64 little-endian float32, 8 values per sample:
        sun unit vector xyz, sun distance km, earth unit vector xyz, earth distance km)
        tests/ephem_truth.json  (direct SPICE values at off-grid epochs, for the JS interpolation test)

Kernels (NAIF generic_kernels, names checked against the directory listings on 2026-11-09):
  lsk/naif0012.tls
  spk/planets/de440s.bsp
  pck/moon_pa_de440_200625.bpc        Moon principal-axis orientation from DE440
  fk/satellites/moon_de440_250416.tf  defines MOON_PA_DE440, MOON_ME_DE440_ME421 and the MOON_ME alias

Vectors are spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON'): apparent position (one-way light time and
stellar aberration) for an observer at the Moon's centre, in the body-fixed frame evaluated at et.
The browser moves the observer to the surface by subtracting the site vector (exact parallax).

Usage:  python tools/ephem/make_ephem.py [--start 2026-09-01] [--stop 2030-01-01] [--step-min 120]
"""
import argparse, base64, json, os, sys, urllib.request
from datetime import datetime, timezone
import numpy as np
import spiceypy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
KDIR = os.path.join(HERE, 'kernels')
NAIF = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'
KERNELS = [
    ('lsk/naif0012.tls', 'naif0012.tls'),
    ('spk/planets/de440s.bsp', 'de440s.bsp'),
    ('pck/moon_pa_de440_200625.bpc', 'moon_pa_de440_200625.bpc'),
    ('fk/satellites/moon_de440_250416.tf', 'moon_de440_250416.tf'),
]
FRAME, ABCORR = 'MOON_ME', 'LT+S'


def furnish():
    os.makedirs(KDIR, exist_ok=True)
    for rel, name in KERNELS:
        p = os.path.join(KDIR, name)
        if not os.path.exists(p):
            print('downloading', rel)
            urllib.request.urlretrieve(NAIF + rel, p)
        sp.furnsh(p)


def utc_ms(s):
    return int(datetime.strptime(s, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp() * 1000)


def et_of_ms(ms):
    # UTC milliseconds since 1970 -> ET, through the leapseconds kernel
    return sp.str2et(datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'))


def sample(ms):
    et = et_of_ms(ms)
    s, _ = sp.spkpos('SUN', et, FRAME, ABCORR, 'MOON')
    e, _ = sp.spkpos('EARTH', et, FRAME, ABCORR, 'MOON')
    return np.array(s), np.array(e)


def hermite(P, i, f):
    """Catmull-Rom cubic on vectors (same formula as src/core.js); P is (n,3), i the left index, f in [0,1)."""
    p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
    m1, m2 = (p2 - p0) / 2, (p3 - p1) / 2
    f2, f3 = f * f, f * f * f
    return (2*f3 - 3*f2 + 1) * p1 + (f3 - 2*f2 + f) * m1 + (-2*f3 + 3*f2) * p2 + (f3 - f2) * m2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2026-09-01')
    ap.add_argument('--stop', default='2030-01-01')
    ap.add_argument('--step-min', type=int, default=120)
    a = ap.parse_args()
    furnish()
    t0, t1, step = utc_ms(a.start), utc_ms(a.stop), a.step_min * 60000
    n = (t1 - t0) // step + 1
    S = np.zeros((n, 3)); E = np.zeros((n, 3))
    for i in range(n):
        S[i], E[i] = sample(t0 + i * step)
    sd, ed = np.linalg.norm(S, axis=1), np.linalg.norm(E, axis=1)
    out = np.zeros((n, 8), dtype='<f4')
    out[:, 0:3] = S / sd[:, None]; out[:, 3] = sd
    out[:, 4:7] = E / ed[:, None]; out[:, 7] = ed

    # Interpolation error: the stored float32 grid, interpolated as the browser does, against direct SPICE.
    rng = np.random.default_rng(1)
    G = out.astype(np.float64)
    worst = {'sun_deg': 0.0, 'earth_deg': 0.0, 'sun_km': 0.0, 'earth_km': 0.0}
    truth = []
    for k in range(4000):
        x = rng.uniform(1, n - 3)
        i, f = int(x), x - int(x)
        ms = t0 + x * step
        s, e = sample(ms)
        for nm, col, v in (('sun', 0, s), ('earth', 4, e)):
            u = hermite(G[:, col:col + 3], i, f); u /= np.linalg.norm(u)
            d = hermite(G[:, col + 3:col + 4], i, f)[0]
            ang = np.degrees(np.arccos(np.clip(np.dot(u, v / np.linalg.norm(v)), -1, 1)))
            worst[nm + '_deg'] = max(worst[nm + '_deg'], ang)
            worst[nm + '_km'] = max(worst[nm + '_km'], abs(d - np.linalg.norm(v)))
        if k < 200:
            truth.append({'ms': ms, 'sun': s.tolist(), 'earth': e.tolist()})
    print('samples', n, 'step', a.step_min, 'min; worst interpolation error over 4000 random epochs:', worst)

    meta = {
        'frame': FRAME, 'abcorr': ABCORR, 'observer': 'MOON (centre)', 'kernels': [k[1] for k in KERNELS],
        'toolkit': sp.tkvrsn('TOOLKIT'), 't0_ms': t0, 'step_ms': step, 'n': int(n),
        'layout': 'float32 LE x8: sun unit xyz, sun km, earth unit xyz, earth km',
        'interp': 'Catmull-Rom cubic on unit vectors, renormalised', 'interp_worst': {k: float(v) for k, v in worst.items()},
        'made': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
    }
    with open(os.path.join(ROOT, 'data', 'ephem.json'), 'w') as f:
        json.dump({'meta': meta, 'b64': base64.b64encode(out.tobytes()).decode()}, f)
    with open(os.path.join(ROOT, 'tests', 'ephem_truth.json'), 'w') as f:
        json.dump({'meta': meta, 'samples': truth}, f)
    print('wrote data/ephem.json', os.path.getsize(os.path.join(ROOT, 'data', 'ephem.json')), 'bytes')


if __name__ == '__main__':
    main()
