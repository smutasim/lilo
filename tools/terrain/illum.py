"""Illumination from a horizon mask: SPICE Sun/Earth vectors in MOON_ME and visible-disk fractions.

The disk-fraction rule is the same one src/core.js uses (CLAUDE.md P1.4): cut the disk into vertical chords,
look up the mask at each chord's azimuth, and sum the visible part of every chord.
"""
import os, sys
import numpy as np
import spiceypy as sp

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ephem'))
import make_ephem as me  # noqa: E402

R_KM = 1737.4
R_SUN_KM = 695700.0     # IAU 2015 nominal solar radius
R_EARTH_KM = 6378.137
NCHORD = 24
_loaded = False


def vectors(target, utc0, utc1, step_s):
    """Apparent target position (km, MOON_ME, LT+S) from the Moon's centre on a uniform UTC grid."""
    global _loaded
    if not _loaded:
        me.furnish(); _loaded = True
    et0, et1 = sp.str2et(utc0), sp.str2et(utc1)
    ets = np.arange(et0, et1, step_s)
    out = np.empty((len(ets), 3))
    for i, et in enumerate(ets):
        out[i] = sp.spkpos(target, et, me.FRAME, me.ABCORR, 'MOON')[0]
    return ets, out


def site_frame(lat, lon):
    p, l = np.radians(lat), np.radians(lon)
    u = np.array([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)])
    e = np.array([-np.sin(l), np.cos(l), 0.0])
    return u, e, np.cross(u, e)


def az_el(vec_km, lat, lon, h_m):
    """Topocentric azimuth/elevation (deg) and range (km) of Moon-centred vectors for a site at height h_m."""
    u, e, n = site_frame(lat, lon)
    d = vec_km - (R_KM + h_m / 1000.0) * u
    rng = np.linalg.norm(d, axis=1)
    return np.degrees(np.arctan2(d @ e, d @ n)) % 360, np.degrees(np.arcsin((d @ u) / rng)), rng


def mask_at(mask, az):
    nb = len(mask)
    x = np.asarray(az) / 360.0 * nb
    i = np.floor(x).astype(int)
    f = x - i
    return mask[i % nb] * (1 - f) + mask[(i + 1) % nb] * f


def disk_fraction(mask, az, el, rad):
    """Fraction of a disk (centre az/el, angular radius rad, all deg, arrays) above the mask."""
    az, el, rad = np.asarray(az), np.asarray(el), np.asarray(rad)
    vis = np.zeros_like(el); tot = np.zeros_like(el)
    cosel = np.maximum(np.cos(np.radians(el)), 1e-6)
    for k in range(NCHORD):
        x = (2 * (k + 0.5) / NCHORD - 1) * rad
        c = np.sqrt(np.maximum(rad * rad - x * x, 0))
        h = mask_at(mask, az + x / cosel)
        vis += np.clip(el + c - h, 0, 2 * c); tot += 2 * c
    return vis / tot


def longest_run(flag, step_h):
    """Longest run of True in a boolean series, in days."""
    best = cur = 0
    for f in flag:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best * step_h / 24.0
