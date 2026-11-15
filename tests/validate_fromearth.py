"""Validate the From Earth view's Moon azimuth and elevation against JPL Horizons.

Observer: Goldstone DSS-14, geodetic WGS 84 from DSN 810-005 Module 301 Rev. N Table 5 (the page's default).
Horizons: observer table, COMMAND='301', CENTER='coord@399', COORD_TYPE='GEODETIC',
SITE_COORD='E-lon,lat,alt_km', QUANTITIES='4', APPARENT='AIRLESS' and 'REFRACTED'.
Page: window.LWB_FE(ms) in the built page (astronomy-engine topocentric Moon; refraction 'normal').
Targets (display feature for the public, not used in any link statistic): |d| < 0.05 deg airless,
< 0.1 deg refracted above 5 deg elevation. Azimuth differences are scaled by cos(elevation).

Usage: .venv/Scripts/python tests/validate_fromearth.py   (needs network; builds nothing: run npm run build first)
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT = 35 + 25 / 60 + 33.24312 / 3600
LON = 243 + 6 / 60 + 37.66244 / 3600
H_KM = 1.001390
EPOCHS = ['2026-12-01 06:00', '2026-12-08 22:30', '2027-01-15 03:10', '2027-03-20 14:40', '2027-05-25 21:20',
          '2027-07-30 08:50', '2027-10-05 17:30', '2027-12-10 11:00']
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'


def horizons(epoch, apparent):
    q = {'format': 'text', 'COMMAND': "'301'", 'EPHEM_TYPE': "'OBSERVER'", 'CENTER': "'coord@399'",
         'COORD_TYPE': "'GEODETIC'", 'SITE_COORD': "'%.6f,%.6f,%.6f'" % (LON, LAT, H_KM), 'START_TIME': "'%s'" % epoch,
         'STOP_TIME': "'%s'" % (datetime.strptime(epoch, '%Y-%m-%d %H:%M') + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M'),
         'STEP_SIZE': "'1 m'", 'QUANTITIES': "'4'", 'APPARENT': "'%s'" % apparent, 'ANG_FORMAT': "'DEG'", 'TIME_TYPE': "'UT'"}
    txt = urllib.request.urlopen(API + '?' + urllib.parse.urlencode(q), timeout=60).read().decode()
    row = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()[0].split()
    return float(row[-2]), float(row[-1])


def horizons_q(epoch, quant):
    q = {'format': 'text', 'COMMAND': "'301'", 'EPHEM_TYPE': "'OBSERVER'", 'CENTER': "'coord@399'",
         'COORD_TYPE': "'GEODETIC'", 'SITE_COORD': "'%.6f,%.6f,%.6f'" % (LON, LAT, H_KM), 'START_TIME': "'%s'" % epoch,
         'STOP_TIME': "'%s'" % (datetime.strptime(epoch, '%Y-%m-%d %H:%M') + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M'),
         'STEP_SIZE': "'1 m'", 'QUANTITIES': "'%s'" % quant, 'ANG_FORMAT': "'DEG'", 'TIME_TYPE': "'UT'"}
    txt = urllib.request.urlopen(API + '?' + urllib.parse.urlencode(q), timeout=60).read().decode()
    row = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()[0].split()
    return float(row[-2]), float(row[-1])


def main():
    page = 'file:///' + os.path.join(ROOT, 'dist', 'index.html').replace('\\', '/')
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); pg.goto(page); pg.wait_for_function('window.LWB_FE', timeout=60000)
        app = []
        for ep in EPOCHS:
            ms = int(datetime.strptime(ep, '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)
            app.append(pg.evaluate('ms => window.LWB_FE(ms)', ms))
        b.close()
    worst_a, worst_r = 0.0, 0.0
    print('UTC               | Horizons airless az/el    | page az/el            | d airless | Horizons refr el | page app el | d refr')
    for ep, a in zip(EPOCHS, app):
        haz, hel = horizons(ep, 'AIRLESS'); time.sleep(0.3)
        _, hre = horizons(ep, 'REFRACTED'); time.sleep(0.3)
        da = max(abs((a['az'] - haz + 180) % 360 - 180) * math.cos(math.radians(hel)), abs(a['alt'] - hel))
        dr = abs(a['app'] - hre) if hel > 5 else float('nan')
        worst_a = max(worst_a, da)
        if hel > 5: worst_r = max(worst_r, dr)
        print('%-17s | %9.4f %9.4f      | %9.4f %9.4f | %.4f    | %9.4f        | %9.4f   | %s' % (ep, haz, hel, a['az'], a['alt'], da, hre, a['app'], 'n/a (low)' if hel <= 5 else '%.4f' % dr))
    # libration: the sub-observer point on the Moon (Horizons quantity 14, ObsSub-LON / ObsSub-LAT), which sets where the
    # landing site appears on the binocular disk. The page uses the IAU rotation model; Horizons uses its lunar frame.
    worst_l = 0.0
    print('UTC               | Horizons sub-obs lon/lat | page lon/lat        | d (deg)')
    for ep, a in zip(EPOCHS, app):
        hl, hb = horizons_q(ep, '14'); time.sleep(0.3)
        d = max(abs((a['subLon'] - hl + 180) % 360 - 180) * math.cos(math.radians(hb)), abs(a['subLat'] - hb))
        worst_l = max(worst_l, d)
        print('%-17s | %9.4f %9.4f      | %9.4f %9.4f | %.4f' % (ep, hl, hb, a['subLon'], a['subLat'], d))
    print('worst sub-observer difference %.4f deg (target < 0.05)' % worst_l)
    ok = worst_a < 0.05 and worst_r < 0.1 and worst_l < 0.05
    print('worst: airless %.4f deg (target < 0.05), refracted above 5 deg %.4f deg (target < 0.1) -> %s' % (worst_a, worst_r, 'PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
