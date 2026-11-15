"""LOLA south-polar terrain: DEM access, 3D horizon masks, slopes.

Grids (all south polar stereographic, true scale at the pole, sphere R = 1737.4 km, MOON_ME of DE421,
heights in metres above the sphere, pixel-registered; projection parameters read from the GeoTIFF tags
and the PDS label, see tools/terrain/inspect_tif.py and data/raw/ldem_60s_240m.lbl):

  tile  PGDA LOLA_5mpp  <Site>_final_adj_5mpp_surf.tif   5 m/px   (Barker et al. 2021)
  m20   PGDA LOLA_20mpp LDEM_80S_20MPP_ADJ.TIF           20 m/px  80S-90S
  m240  PDS  LDEM_60S_240M.IMG                           240 m/px 60S-90S

Map convention: x = r sin(lon), y = r cos(lon), r = 2R tan(colat/2), lon east-positive.

Horizon mask at an observer (CLAUDE.md P1.2). All angles are computed from 3D body-fixed vectors:
elevation = angle between the vector observer->sample and the plane normal to the observer's radial "up";
azimuth = bearing of that vector, clockwise from local north. Curvature is therefore included exactly.

  1. Ray casting, 0 -> RAY_MAX: for each azimuth bin centre, march along the great circle, sampling the
     finest DEM that covers each point with bilinear interpolation (no overshoot). Step = half a pixel of
     that DEM, growing to 0.2 % of range.
  2. Scatter, where pixels subtend less than a bin: every 20 m pixel in an annulus and every 240 m pixel
     in a wider annulus is converted to 3D and max-binned. No far peak can fall between rays.

The mask value for bin k is the highest elevation found at azimuth k * 360/NB degrees.
"""
import os
import numpy as np
import numba as nb
import tifffile

R = 1737400.0
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'data', 'raw')

RAY_MAX = 55e3          # m; a 240 m pixel subtends half a 0.25 deg bin at 55 km
SC20 = (4e3, 50e3)      # m; annulus scattered from the 20 m grid
SC240 = (45e3, 400e3)   # m; annulus scattered from the 240 m grid
NB = 1440               # 0.25 deg bins


# ---------------------------------------------------------------- projection
def ll_to_xy(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    r = 2 * R * np.tan(np.pi / 4 + lat / 2)
    return r * np.sin(lon), r * np.cos(lon)


def xy_to_ll(x, y):
    r = np.hypot(x, y)
    return np.degrees(2 * np.arctan(r / (2 * R)) - np.pi / 2), np.degrees(np.arctan2(x, y)) % 360


# ---------------------------------------------------------------- data
def load_tile(name):
    """PGDA 5 m site tile -> (array, x0, y0, res). x0/y0 are the outer edges of the top-left pixel."""
    p = os.path.join(RAW, name + '_final_adj_5mpp_surf.tif')
    with tifffile.TiffFile(p) as t:
        pg = t.pages[0]
        sx, sy, _ = pg.tags['ModelPixelScaleTag'].value
        tie = pg.tags['ModelTiepointTag'].value
        assert sx == sy == 5.0 and tie[0] == 0 and tie[1] == 0
        return np.ascontiguousarray(pg.asarray(), dtype=np.float32), tie[3], tie[4], sx


def load_m20():
    """20 m mosaic as float32 in RAM (3.7 GB). Cached as a raw file next to the GeoTIFF on first use."""
    cache = os.path.join(RAW, 'LDEM_80S_20MPP_ADJ.f32')
    if not os.path.exists(cache):
        with tifffile.TiffFile(os.path.join(RAW, 'LDEM_80S_20MPP_ADJ.TIF')) as t:
            pg = t.pages[0]
            assert pg.tags['ModelPixelScaleTag'].value[0] == 20.0
            assert pg.tags['ModelTiepointTag'].value[3:5] == (-304000.0, 304000.0)
            pg.asarray().astype('<f4').tofile(cache)
    return np.fromfile(cache, dtype='<f4').reshape(30400, 30400), -304000.0, 304000.0, 20.0


def load_m240():
    """PDS LDEM_60S_240M.IMG: int16 LSB, HEIGHT = DN * 0.5 m, 7760 x 7760, projection offset 3879.5."""
    a = np.fromfile(os.path.join(RAW, 'ldem_60s_240m.img'), dtype='<i2').reshape(7760, 7760)
    return (a * 0.5).astype(np.float32), -3880 * 240.0, 3880 * 240.0, 240.0


NO_TILE = (np.full((2, 2), np.nan, dtype=np.float32), 0.0, 0.0, 5.0)


# ---------------------------------------------------------------- kernels
@nb.njit(cache=True)
def _bil(a, x0, y0, res, x, y):
    fx = (x - x0) / res - 0.5
    fy = (y0 - y) / res - 0.5
    j = int(np.floor(fx)); i = int(np.floor(fy))
    if j < 0 or i < 0 or j + 1 >= a.shape[1] or i + 1 >= a.shape[0]:
        return np.nan
    tx = fx - j; ty = fy - i
    return (a[i, j] * (1 - tx) + a[i, j + 1] * tx) * (1 - ty) + (a[i + 1, j] * (1 - tx) + a[i + 1, j + 1] * tx) * ty


@nb.njit(cache=True)
def height(t, tx0, ty0, tres, m20, m240, x, y):
    """Bilinear height from the finest grid covering (x, y). Returns (h, resolution used)."""
    h = _bil(t, tx0, ty0, tres, x, y)
    if not np.isnan(h):
        return h, tres
    h = _bil(m20, -304000.0, 304000.0, 20.0, x, y)
    if not np.isnan(h):
        return h, 20.0
    return _bil(m240, -931200.0, 931200.0, 240.0, x, y), 240.0


@nb.njit(cache=True)
def _u(x, y):
    q = (x * x + y * y) / (4 * R * R)
    k = 1.0 / (R * (1 + q))
    return y * k, x * k, -(1 - q) / (1 + q)


@nb.njit(cache=True)
def _frame(x, y):
    """Unit up, east, north (body-fixed) at map point (x, y)."""
    ux, uy, uz = _u(x, y)
    el = np.hypot(ux, uy)
    ex, ey = -uy / el, ux / el
    nx, ny, nz = uy * 0 - uz * ey, uz * ex - ux * 0, ux * ey - uy * ex
    return ux, uy, uz, ex, ey, 0.0, nx, ny, nz


@nb.njit(cache=True)
def offset_xy(x, y, de, dn):
    """Map point reached from (x, y) by a local east/north offset in metres (tangent-plane, km-scale)."""
    ux, uy, uz, ex, ey, ez, nx, ny, nz = _frame(x, y)
    vx = ux + (de * ex + dn * nx) / R; vy = uy + (de * ey + dn * ny) / R; vz = uz + (de * ez + dn * nz) / R
    l = np.sqrt(vx * vx + vy * vy + vz * vz)
    vx /= l; vy /= l; vz /= l
    return 2 * R * vy / (1 - vz), 2 * R * vx / (1 - vz)


@nb.njit(cache=True)
def _scatter(a, x0, y0, res, xo, yo, P, F, rmin, rmax, i0, i1, el_out, d_out):
    ux, uy, uz, ex, ey, ez, nx, ny, nz = F
    nbins = el_out.shape[0]
    j0 = max(0, int((xo - rmax - x0) / res)); j1 = min(a.shape[1], int((xo + rmax - x0) / res) + 1)
    for i in range(i0, i1):
        y = y0 - (i + 0.5) * res
        dy2 = (y - yo) ** 2
        if dy2 > rmax * rmax:
            continue
        for j in range(j0, j1):
            x = x0 + (j + 0.5) * res
            d2 = (x - xo) ** 2 + dy2
            if d2 < rmin * rmin or d2 > rmax * rmax:
                continue
            h = a[i, j]
            if np.isnan(h):
                continue
            sx, sy, sz = _u(x, y)
            rr = R + h
            dx = rr * sx - P[0]; dy = rr * sy - P[1]; dz = rr * sz - P[2]
            up = dx * ux + dy * uy + dz * uz
            dl = np.sqrt(dx * dx + dy * dy + dz * dz)
            el = np.arcsin(up / dl)
            az = np.arctan2(dx * ex + dy * ey + dz * ez, dx * nx + dy * ny + dz * nz)
            k = int(np.floor(az / (2 * np.pi) * nbins + 0.5)) % nbins
            if el > el_out[k]:
                el_out[k] = el; d_out[k] = dl


@nb.njit(parallel=True, cache=True)
def horizon_mask(t, tx0, ty0, tres, m20, m240, xo, yo, hobs, nbins, use20, use240):
    """Horizon elevation (deg) and distance to the horizon point (m) per azimuth bin, plus ground height."""
    hg, _ = height(t, tx0, ty0, tres, m20, m240, xo, yo)
    F = _frame(xo, yo)
    ux, uy, uz, ex, ey, ez, nx, ny, nz = F
    ro = R + hg + hobs
    P = (ro * ux, ro * uy, ro * uz)
    el = np.full(nbins, -np.pi / 2); dist = np.zeros(nbins)
    # 1. rays
    for k in nb.prange(nbins):
        az = 2 * np.pi * k / nbins
        tx = np.sin(az) * ex + np.cos(az) * nx; ty = np.sin(az) * ey + np.cos(az) * ny; tz = np.sin(az) * ez + np.cos(az) * nz
        s = 0.5 * tres
        best = -np.pi / 2; bd = 0.0
        while s < RAY_MAX:
            th = s / R
            c = np.cos(th); sn = np.sin(th)
            vx = c * ux + sn * tx; vy = c * uy + sn * ty; vz = c * uz + sn * tz
            x = 2 * R * vy / (1 - vz); y = 2 * R * vx / (1 - vz)
            h, res = height(t, tx0, ty0, tres, m20, m240, x, y)
            if not np.isnan(h):
                rr = R + h
                dx = rr * vx - P[0]; dy = rr * vy - P[1]; dz = rr * vz - P[2]
                dl = np.sqrt(dx * dx + dy * dy + dz * dz)
                e = np.arcsin((dx * ux + dy * uy + dz * uz) / dl)
                if e > best:
                    best = e; bd = dl
            s += max(0.5 * res, 0.002 * s)
        el[k] = best; dist[k] = bd
    # 2. scatter (row chunks, per-chunk maxima merged afterwards)
    NC = 48
    for which in range(2):
        if (which == 0 and not use20) or (which == 1 and not use240):
            continue
        if which == 0:
            a = m20; x0 = -304000.0; y0 = 304000.0; res = 20.0; rmin = SC20[0]; rmax = SC20[1]
        else:
            a = m240; x0 = -931200.0; y0 = 931200.0; res = 240.0; rmin = SC240[0]; rmax = SC240[1]
        r0 = max(0, int((y0 - (yo + rmax)) / res)); r1 = min(a.shape[0], int((y0 - (yo - rmax)) / res) + 1)
        if r1 <= r0:
            continue
        els = np.full((NC, nbins), -np.pi / 2); ds = np.zeros((NC, nbins))
        for c in nb.prange(NC):
            _scatter(a, x0, y0, res, xo, yo, P, F, rmin, rmax, r0 + (r1 - r0) * c // NC, r0 + (r1 - r0) * (c + 1) // NC, els[c], ds[c])
        for c in range(NC):
            for k in range(nbins):
                if els[c, k] > el[k]:
                    el[k] = els[c, k]; dist[k] = ds[c, k]
    return np.degrees(el), dist, hg


@nb.njit(cache=True)
def _b3(t):
    t = abs(t)
    if t < 1: return (4 - 6 * t * t + 3 * t * t * t) / 6
    if t < 2: return (2 - t) ** 3 / 6
    return 0.0


@nb.njit(cache=True)
def _db3(t):
    s = 1.0 if t >= 0 else -1.0
    t = abs(t)
    if t < 1: return s * (-12 * t + 9 * t * t) / 6
    if t < 2: return -s * (2 - t) ** 2 / 2
    return 0.0


@nb.njit(cache=True)
def slope_bspline(a, x0, y0, res, x, y):
    """Slope (deg) from the gradient of the cubic B-spline approximant of the grid (smooth, non-interpolating:
    no overshoot at crater rims). At a node this is a central difference over 2 pixels, smoothed 1-4-1 across."""
    fx = (x - x0) / res - 0.5; fy = (y0 - y) / res - 0.5
    j = int(np.floor(fx)); i = int(np.floor(fy))
    if j < 1 or i < 1 or j + 2 >= a.shape[1] or i + 2 >= a.shape[0]:
        return np.nan
    gx = 0.0; gy = 0.0
    for m in range(-1, 3):
        for n in range(-1, 3):
            z = a[i + m, j + n]
            if np.isnan(z):
                return np.nan
            gx += z * _db3(fx - (j + n)) * _b3(fy - (i + m))
            gy += z * _b3(fx - (j + n)) * _db3(fy - (i + m))
    k = 1 + (x * x + y * y) / (4 * R * R)   # stereographic scale factor: map metres per ground metre
    return np.degrees(np.arctan(np.hypot(gx, gy) / res * k))
