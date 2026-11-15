"""Validate the app's Sun/Earth azimuth and elevation against JPL Horizons (CLAUDE.md P0.2).

Horizons: observer table, CENTER='coord@301', COORD_TYPE='GEODETIC', SITE_COORD='E-lon,lat,alt_km',
QUANTITIES='4' (apparent azimuth/elevation), APPARENT='AIRLESS'. The response header reports
"Center pole/equ : MEAN_ME (high precision)", i.e. the lunar mean Earth / polar axis frame, the same
frame as the app's SPICE path (MOON_ME), so no frame conversion is applied. Horizons uses DE441.

Compared: (1) the app's SPICE path (precomputed DE440 grid, interpolated in src/core.js),
          (2) the app's astronomy-engine fallback (IAU rotation model).
Targets: |diff| < 0.05 deg for (1), < 0.3 deg for (2). Azimuth differences are scaled by cos(elevation).

Usage: python tests/validate_horizons.py      (needs network and Node on PATH)
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = [('Apollo 11 LM', 0.67416, 23.47314), ('Apollo 15 LM', 26.13239, 3.63330),
         ('Shackleton rim', -89.6864, 197.0629), ("Chang'e-4 (far side)", -45.4446, 177.5991)]
EPOCHS = ['2027-01-15 03:10', '2027-03-20 14:40', '2027-05-25 21:20', '2027-07-30 08:50', '2027-10-05 17:30', '2027-12-10 11:00']
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'


def horizons(body, lat, lon, epoch):
    q = {'format': 'text', 'COMMAND': "'%s'" % body, 'EPHEM_TYPE': "'OBSERVER'", 'CENTER': "'coord@301'",
         'COORD_TYPE': "'GEODETIC'", 'SITE_COORD': "'%.5f,%.5f,0'" % (lon, lat), 'START_TIME': "'%s'" % epoch,
         'STOP_TIME': "'%s'" % (datetime.strptime(epoch, '%Y-%m-%d %H:%M') + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M'), 'STEP_SIZE': "'1 m'",
         'QUANTITIES': "'4'", 'APPARENT': "'AIRLESS'", 'ANG_FORMAT': "'DEG'"}
    txt = urllib.request.urlopen(API + '?' + urllib.parse.urlencode(q), timeout=60).read().decode()
    frame = re.search(r'Center pole/equ\s*:\s*(\S+)', txt).group(1)
    row = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()[0].split()
    return float(row[-2]), float(row[-1]), frame


def main():
    import math
    pts, ref = [], []
    for name, lat, lon in SITES:
        for ep in EPOCHS:
            ms = int(datetime.strptime(ep, '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)
            saz, sel, frame = horizons('10', lat, lon, ep)
            eaz, eel, _ = horizons('399', lat, lon, ep)
            pts.append({'lat': lat, 'lon': lon, 'ms': ms}); ref.append((name, ep, saz, sel, eaz, eel, frame))
    app = json.loads(subprocess.run(['node', os.path.join(ROOT, 'tests', 'app_azel.js')], input=json.dumps({'points': pts}),
                                    capture_output=True, text=True, check=True).stdout)
    worst = {'spice': 0.0, 'ae': 0.0}
    rows = []
    print('Horizons center frame:', ref[0][6])
    print('%-22s %-17s | Horizons sun az/el, earth az/el            | SPICE path max|d| deg | fallback max|d| deg' % ('site', 'UTC'))
    for (name, ep, saz, sel, eaz, eel, _), a in zip(ref, app):
        d = {}
        for k in ('spice', 'ae'):
            o = a[k]
            daz = lambda x, y, el: abs((x - y + 180) % 360 - 180) * math.cos(math.radians(el))
            d[k] = max(daz(o['sunAz'], saz, sel), abs(o['sunEl'] - sel), daz(o['earthAz'], eaz, eel), abs(o['earthEl'] - eel))
            worst[k] = max(worst[k], d[k])
        rows.append({'site': name, 'utc': ep, 'horizons': [saz, sel, eaz, eel], 'd_spice': d['spice'], 'd_ae': d['ae']})
        print('%-22s %-17s | %9.4f %9.4f  %9.4f %9.4f | %.5f               | %.4f' % (name, ep, saz, sel, eaz, eel, d['spice'], d['ae']))
    ok = worst['spice'] < 0.05 and worst['ae'] < 0.3
    print('worst: SPICE path %.5f deg (target < 0.05), fallback %.4f deg (target < 0.3) -> %s' % (worst['spice'], worst['ae'], 'PASS' if ok else 'FAIL'))
    os.makedirs(os.path.join(ROOT, 'tests', 'out'), exist_ok=True)
    json.dump({'frame': ref[0][6], 'worst': worst, 'rows': rows}, open(os.path.join(ROOT, 'tests', 'out', 'validate_horizons.json'), 'w'), indent=1)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
