"""Build the LROC imagery the page shows, and the 3D terrain patches, from public NASA products.

Imagery: LROC WAC south-pole summer mosaic, WAC_ROI_SOUTH_SUMMER_100M (Speyerer et al. 2020, Lunar Surface
Science Workshop #5132), 643 nm band, images of 2010-09-21 to 2010-10-23. Read from the PDS LROC node as the
tiled pyramid GeoTIFF over HTTP range requests (only the tiles needed; cached in data/raw/http_cache).
Its GeoTIFF keys (checked below, not assumed): polar stereographic, natural origin 90 S, straight vertical
pole longitude 0, scale 1 at the origin, sphere 1737.4 km, 100 m pixels, upper-left corner (-1439300, 1439300).
That is the projection of every LOLA grid this project uses (tools/terrain/lolaterrain.py), so the imagery is
cut to the page's grids with bilinear interpolation and no reprojection.

Outputs
  data/imagery.json           the polar cap of the page's south-pole maps: 1248 x 1248 px, 240 m/px, +-149.76 km
                              (the extent of data/polar.json), from pyramid level 1 (200 m), as an 8-bit JPEG.
  data/terrain3d/<id>.json    per listed site south of 60 S: a square of LOLA heights on a local east/north grid
                              centred on the site (from the 20 m mosaic block-averaged to the node spacing, or the
                              240 m grid north of 80 S), relative to the site's ground height, int16 metres,
                              plus the WAC image at the same nodes. Display only: the 3D view.

Registration check (printed and written to tests/out/imagery_check.json, see registration_check): the image
against LOLA relief shaded with the mosaic's own noon Sun; the best shift must be zero.
"""
import base64, gzip, json, os, sys
import numpy as np
import imagecodecs
import tifffile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'terrain'))
from httpfile import HTTPFile
import lolaterrain as lt

URL = ('https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/WAC_ROI/'
       'WAC_ROI_SOUTH_SUMMER/WAC_ROI_SOUTH_SUMMER_100M.PYR.TIF')
OUT = os.path.join(lt.ROOT, 'data')


class Pyramid:
    """Window reads from the tiled, uncompressed pyramid levels of the remote GeoTIFF."""
    def __init__(self):
        self.f = HTTPFile(URL, os.path.join(lt.RAW, 'http_cache'))
        self.t = tifffile.TiffFile(self.f)
        p = self.t.pages[0]
        g = {k: p.tags[k].value for k in ('ModelPixelScaleTag', 'ModelTiepointTag', 'GeoDoubleParamsTag', 'GeoKeyDirectoryTag')}
        keys = g['GeoKeyDirectoryTag']; kd = {keys[i]: keys[i + 1:i + 4] for i in range(4, len(keys), 4)}
        dbl = g['GeoDoubleParamsTag']
        def dval(k): loc, cnt, idx = kd[k]; return dbl[idx] if loc == 34736 else idx
        assert kd[3075][2] == 15, 'expected polar stereographic (CT 15)'
        assert dval(3081) == -90.0 and dval(3095) == 0.0 and dval(3092) == 1.0, 'expected origin 90S, pole longitude 0, scale 1'
        assert dbl[0] == dbl[1] == lt.R, 'expected the 1737.4 km sphere'
        assert g['ModelPixelScaleTag'][:2] == (100.0, 100.0) and g['ModelTiepointTag'][3:5] == (-1439300.0, 1439300.0)
        self.x0, self.y0, self.res0 = -1439300.0, 1439300.0, 100.0
        self.W0 = p.shape[1]
        self.cache = {}

    def level(self, k):
        p = self.t.pages[k]
        return p, self.res0 * self.W0 / p.shape[1]

    def tile(self, k, ty, tx):
        key = (k, ty, tx)
        if key in self.cache: return self.cache[key]
        p = self.t.pages[k]; nx = -(-p.shape[1] // p.tilewidth)
        i = ty * nx + tx
        self.f.seek(p.dataoffsets[i]); raw = self.f.read(p.databytecounts[i])
        a = np.frombuffer(raw, dtype=np.uint8).reshape(p.tilelength, p.tilewidth)
        self.cache[key] = a
        return a

    def window(self, k, r0, r1, c0, c1):
        p = self.t.pages[k]; T = p.tilewidth; H, W = p.shape
        r0, c0 = max(0, r0), max(0, c0); r1, c1 = min(H, r1), min(W, c1)
        out = np.zeros((r1 - r0, c1 - c0), np.uint8)
        for ty in range(r0 // T, (r1 - 1) // T + 1):
            for tx in range(c0 // T, (c1 - 1) // T + 1):
                a = self.tile(k, ty, tx)
                ra, rb = max(r0, ty * T), min(r1, ty * T + T); ca, cb = max(c0, tx * T), min(c1, tx * T + T)
                out[ra - r0:rb - r0, ca - c0:cb - c0] = a[ra - ty * T:rb - ty * T, ca - tx * T:cb - tx * T]
        return out, r0, c0

    def sample(self, k, X, Y):
        """Bilinear image value at map points (arrays X, Y in metres) from pyramid level k."""
        _, res = self.level(k)
        fx = (X - self.x0) / res - 0.5; fy = (self.y0 - Y) / res - 0.5
        r0, r1 = int(np.floor(fy.min())) - 1, int(np.ceil(fy.max())) + 2
        c0, c1 = int(np.floor(fx.min())) - 1, int(np.ceil(fx.max())) + 2
        a, ra, ca = self.window(k, r0, r1, c0, c1)
        a = a.astype(np.float32)
        fy -= ra; fx -= ca
        i = np.clip(np.floor(fy).astype(int), 0, a.shape[0] - 2); j = np.clip(np.floor(fx).astype(int), 0, a.shape[1] - 2)
        u = np.clip(fy - i, 0, 1); v = np.clip(fx - j, 0, 1)
        return (a[i, j] * (1 - u) * (1 - v) + a[i, j + 1] * (1 - u) * v + a[i + 1, j] * u * (1 - v) + a[i + 1, j + 1] * u * v)


def jpeg(a, q=82):
    return base64.b64encode(imagecodecs.jpeg8_encode(np.clip(a, 0, 255).astype(np.uint8), level=q)).decode()


def stretch(a, lo_p=0.5, hi_p=99.7):
    """Linear 8-bit stretch between percentiles of the non-zero pixels (zero is no data). Display only."""
    v = a[a > 0]
    lo, hi = np.percentile(v, lo_p), np.percentile(v, hi_p)
    return np.where(a > 0, (a - lo) / max(1.0, hi - lo) * 255, 0), float(lo), float(hi)


def polar_cap(P):
    N, px = 1248, 240.0
    half = N * px / 2
    c = -half + (np.arange(N) + 0.5) * px
    X, Y = np.meshgrid(c, -c)
    img = P.sample(1, X, Y)
    s, lo, hi = stretch(img)
    json.dump({'n': N, 'px_m': px, 'half_m': half, 'jpeg': jpeg(s),
               'source': 'LROC WAC_ROI_SOUTH_SUMMER_100M (Speyerer et al. 2020), 643 nm, 2010-09-21 to 2010-10-23; pyramid level 1 (200 m) resampled bilinear to 240 m; stretch %.0f-%.0f DN' % (lo, hi),
               'note': 'south polar stereographic, x right = 90E, y up = 0E, same grid as polar.json'},
              open(os.path.join(OUT, 'imagery.json'), 'w'))
    return img, X, Y


def registration_check(img):
    """The WAC mosaic was built from images with the Sun near the orbit plane (readme), i.e. local noon: at each
    point the Sun comes from the equator side at elevation ~ 90 - |lat| + 1.5 deg (sub-solar latitude about 1.5 S
    in the image dates). LOLA 240 m relief Lambert-shaded with that Sun is cross-correlated with the image for
    shifts of +-6 px (240 m). Gradient-only comparisons fail here: shadows cast from many azimuths dominate."""
    m240 = lt.load_m240()[0]
    N, px = img.shape[0], 240.0; c = 3880 - N // 2
    h = m240[c:c + N, c:c + N].astype(np.float64)
    cc = (np.arange(N) - N / 2 + 0.5) * px
    X, Y = np.meshgrid(cc, -cc); r = np.hypot(X, Y) + 1e-9
    lat = -(90 - np.degrees(2 * np.arctan(r / (2 * lt.R))))
    gy_row, gx = np.gradient(h, px); gy = -gy_row
    nrm = np.stack([-gx, -gy, np.ones_like(h)]); nrm /= np.linalg.norm(nrm, axis=0)
    e = np.radians(np.clip(91.5 - np.abs(lat), 0.2, 90))
    s = np.stack([np.cos(e) * X / r, np.cos(e) * Y / r, np.sin(e)])
    shade = np.clip((nrm * s).sum(0), 0, None)
    sel = (r > 15e3) & (r < 140e3) & (img > 3)
    def ncc(dx, dy):
        a = np.roll(np.roll(img, -dy, 0), -dx, 1)[sel]; b = shade[sel]
        a = (a - a.mean()) / a.std(); b = (b - b.mean()) / b.std(); return float((a * b).mean())
    S = 6; G = np.array([[ncc(dx, dy) for dx in range(-S, S + 1)] for dy in range(-S, S + 1)])
    k = np.unravel_index(np.argmax(G), G.shape)
    res = {'method': 'normalised cross-correlation, WAC image (240 m cap grid) vs LOLA LDEM_60S_240M Lambert shading with a noon Sun from the equator side at elevation 91.5 - |lat| deg; 15-140 km from the pole; shifts +-6 px',
           'ncc_zero_shift': round(float(G[S, S]), 3), 'ncc_best': round(float(G[k]), 3),
           'best_shift_px': [int(k[1] - S), int(k[0] - S)], 'ncc_median_over_window': round(float(np.median(G)), 3)}
    assert res['best_shift_px'] == [0, 0], 'imagery is not registered to the LOLA grid'
    os.makedirs(os.path.join(lt.ROOT, 'tests', 'out'), exist_ok=True)
    json.dump(res, open(os.path.join(lt.ROOT, 'tests', 'out', 'imagery_check.json'), 'w'), indent=1)
    print('registration:', res)
    return res


def patches(P):
    sites = json.load(open(os.path.join(OUT, 'sites.json')))['sites']
    terr = json.load(open(os.path.join(OUT, 'terrain.json')))['sites']
    os.makedirs(os.path.join(OUT, 'terrain3d'), exist_ok=True)
    m20 = None
    m240 = lt.load_m240()
    for s in sites:
        t = terr.get(s['id'])
        if not t or s['lat'] > -60: continue
        x, y = lt.ll_to_xy(s['lat'], s['lon'])
        use20 = s['lat'] <= -80.6
        n, d = (241, 100.0) if use20 else (121, 240.0)
        half = (n - 1) / 2 * d
        off = (np.arange(n) - (n - 1) / 2) * d
        DE, DN = np.meshgrid(off, -off)                 # row 0 = north edge
        X = np.empty_like(DE); Y = np.empty_like(DE)
        for i in range(n):
            for j in range(n):
                X[i, j], Y[i, j] = lt.offset_xy(x, y, DE[i, j], DN[i, j])
        if use20:
            if m20 is None: m20 = lt.load_m20()
            a, gx0, gy0, res = m20; box = int(round(d / res))
        else:
            a, gx0, gy0, res = m240; box = 1
        fx = (X - gx0) / res - 0.5; fy = (gy0 - Y) / res - 0.5
        r0, c0 = int(fy.min()) - box - 2, int(fx.min()) - box - 2
        r1, c1 = int(fy.max()) + box + 3, int(fx.max()) + box + 3
        win = np.asarray(a[r0:r1, c0:c1], dtype=np.float64)
        if box > 1:                                     # box filter to the node spacing before sampling
            k = np.ones(box) / box
            win = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 0, win)
            win = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 1, win)
        fy -= r0; fx -= c0
        i = np.floor(fy).astype(int); j = np.floor(fx).astype(int); u = fy - i; v = fx - j
        H = win[i, j] * (1 - u) * (1 - v) + win[i, j + 1] * (1 - u) * v + win[i + 1, j] * u * (1 - v) + win[i + 1, j + 1] * u * v
        assert np.isfinite(H).all(), s['id'] + ': DEM gap in the patch'
        h0 = t['h_m']
        z = np.round(H - h0).astype('<i2')
        img = P.sample(0 if use20 else 1, X, Y)
        si, lo, hi = stretch(img)
        rec = {'id': s['id'], 'n': n, 'd_m': d, 'h0_m': h0,
               'z_gz': base64.b64encode(gzip.compress(z.tobytes(), 9)).decode(),
               'img': jpeg(si, 85), 'dem': 'LDEM_80S_20MPP_ADJ box-averaged to %d m' % d if use20 else 'LDEM_60S_240M',
               'img_src': 'LROC WAC_ROI_SOUTH_SUMMER_100M, pyramid level %d' % (0 if use20 else 1),
               'note': 'row 0 = north edge, column 0 = west edge; z = height above the site ground height (m), int16 LSB'}
        json.dump(rec, open(os.path.join(OUT, 'terrain3d', s['id'] + '.json'), 'w'))
        print('patch %-11s %d x %d at %3.0f m, z %+5.0f..%+5.0f m, centre z %+d m, %s' % (s['id'], n, n, d, z.min(), z.max(), int(z[(n - 1) // 2, (n - 1) // 2]), rec['dem']))


if __name__ == '__main__':
    P = Pyramid()
    img, X, Y = polar_cap(P)
    print('wrote data/imagery.json', os.path.getsize(os.path.join(OUT, 'imagery.json')), 'bytes')
    registration_check(img)
    patches(P)
    print('downloaded %.1f MB this run' % (P.f.fetched / 1e6))
