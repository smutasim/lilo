"""Built-in lunar orbiters for the relay-satellite feature, the lunar gravity field, and the truth tables that
validate the propagator in src/prop.js.

Stages (all run by default; pick with --stage):
  gravity    GRGM1200A (GRAIL, GSFC) from the PDS Geosciences node, first ~2.5 MB of the coefficient table by an HTTP
             range request (sorted by degree, so this is degrees 0-200), cached in data/raw/gravity/. Writes
             data/gravity.json truncated to --gmax, full double precision as printed in the file.
             Writes tests/data/gravity_ref.json (to --gref) for the truncation study in tests/check_prop.js.
  fetch      JPL Horizons vector tables (Moon centre 500@301, ICRF, KM-S, hourly) for each spacecraft and span below.
             Raw text kept in tests/data/horizons_<id>_<span>.txt; converted to tests/data/truth_<id>_<span>.json
             with UTC milliseconds from the Horizons TDB Julian dates via SPICE (naif0012.tls, et2utc).
  catalogue  Runs node tests/check_prop.js (which reads the truth files and writes tests/out/check_prop.json), then
             writes data/sats.json: the state at each spacecraft's epoch, its osculating two-body shape, the
             Horizons trajectory identification, and the measured error of the default propagator vs Horizons.

Every constant is taken from a file read here: GM, reference radius and normalisation from the coefficient file's
header record and the PDS label; TDB-UTC from the NAIF leapseconds kernel through SPICE.

Usage:  .venv/Scripts/python.exe tools/sats/make_sats.py [--stage gravity|fetch|catalogue|all] [--gmax 100]
"""
import argparse, json, math, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(ROOT, 'data', 'raw', 'gravity')
TD = os.path.join(ROOT, 'tests', 'data')
KDIR = os.path.join(ROOT, 'tools', 'ephem', 'kernels')
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
UA = 'lunar-window-browser-build'

GRAV_BASE = 'https://pds-geosciences.wustl.edu/grail/grail-l-lgrs-5-rdr-v1/grail_1001/shadr/'
GRAV_TAB = 'gggrx_1200a_sha.tab'
GRAV_LBL = 'gggrx_1200a_sha.lbl'
GRAV_BYTES = 2500000          # header (2 records) + 20300 records of 122 bytes cover degrees 0..200

# Spacecraft and spans. 'about' sentences restate facts from the Horizons header of that object (fetched here and
# kept in tests/data/horizons_<id>_*.txt). Spans: 'now' starts at 2026-11-14 00:00 UTC (the page's current date) and
# runs to the end of the trajectory Horizons serves (or 30 d); the second span lies inside the part of each
# trajectory that the header calls fitted to tracking data (reconstruction / tag-up), to test against data rather
# than against another prediction.
SATS = [
    dict(id='lro', hid='-85', name='LRO', builtin=True,
         about='NASA Lunar Reconnaissance Orbiter (launched 2009-06-18); per the Horizons header now in an extended '
               'mission as a communication relay and south-pole observer.',
         spans=[('now', '2026-11-14', 30), ('fit', '2026-05-01', 30)]),
    dict(id='danuri', hid='-155', name='Danuri (KPLO)', builtin=True,
         about='Korea Pathfinder Lunar Orbiter, KARI (launched 2022-08-04, arrived 2022-12-16); trajectory from KARI '
               'solutions merged with a longer-term prediction.',
         spans=[('now', '2026-11-14', 30), ('fit', '2026-10-10', 30)]),
    dict(id='artemis_p1', hid='-192', name='ARTEMIS-P1 (THEMIS-B)', builtin=True,
         about='NASA THEMIS-B, repurposed as ARTEMIS-P1 to study the lunar environment; in lunar orbit since 2011-06-27.',
         spans=[('now', '2026-11-14', 15), ('fit', '2023-11-01', 30)]),
    dict(id='artemis_p2', hid='-193', name='ARTEMIS-P2 (THEMIS-C)', builtin=True,
         about='NASA THEMIS-C, repurposed as ARTEMIS-P2 to study the lunar environment; in lunar orbit since 2011-07-17.',
         spans=[('now', '2026-11-14', 15), ('fit', '2023-11-01', 30)]),
    dict(id='chandrayaan2', hid='-152', name='Chandrayaan-2 orbiter', builtin=True,
         about='ISRO Chandrayaan-2 orbiter (launched 2019-07-22); its lander Vikram separated on 2019-09-02 and was lost (Horizons header).',
         spans=[('now', '2026-11-14', 27), ('fit', '2026-10-01', 30)]),
    dict(id='capstone', hid='-1176', name='CAPSTONE', builtin=False,
         about='NASA CubeSat pathfinder for Gateway in a near-rectilinear halo orbit; Horizons: completed mission, '
               'no further updates, trajectory ends 2026-08-14.',
         spans=[('fit', '2026-06-14', 30)]),
]


def get(url, rng=None, timeout=180):
    h = {'User-Agent': UA}
    if rng:
        h['Range'] = 'bytes=%d-%d' % rng
    for k in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout).read()
        except Exception as e:  # transient network errors: retry a few times
            if k == 3:
                raise
            print('  retry', url, e)
            time.sleep(5)


# ------------------------------------------------------------------ gravity
def gravity(gmax, gref):
    os.makedirs(RAW, exist_ok=True)
    lbl = os.path.join(RAW, GRAV_LBL)
    tab = os.path.join(RAW, 'gggrx_1200a_sha_0to200.tab')
    if not os.path.exists(lbl):
        open(lbl, 'wb').write(get(GRAV_BASE + GRAV_LBL))
    if not os.path.exists(tab):
        d = get(GRAV_BASE + GRAV_TAB, (0, GRAV_BYTES - 1))
        if len(d) != GRAV_BYTES:
            raise IOError('short range read: %d bytes' % len(d))
        open(tab, 'wb').write(d)
    L = open(lbl).read()
    rec = int(re.search(r'RECORD_BYTES\s*=\s*(\d+)', L).group(1))
    lines = open(tab, 'rb').read().decode('ascii').split('\r\n')
    h = [x.strip() for x in lines[0].split(',')]
    R, GM, sGM, deg, order, norm = float(h[0]), float(h[1]), float(h[2]), int(h[3]), int(h[4]), int(h[5])
    assert norm == 1, 'expected normalised coefficients (header NORMALIZATION STATE = 1)'
    C, S, sC, sS = {}, {}, {}, {}
    for ln in lines[1:]:
        f = ln.split(',')
        if len(f) < 6:
            continue
        try:
            n, m = int(f[0]), int(f[1])
            vals = [float(x) for x in f[2:6]]
        except ValueError:
            continue  # the last, partial record of the range
        C[n, m], S[n, m], sC[n, m], sS[n, m] = vals
    nmax_have = max(n for n, m in C if all((n, k) in C for k in range(n + 1)))
    label_gm = re.search(r'GM = ([0-9.]+)', L).group(1)

    def pack(N, keep_sigma):
        c, s, sc = [], [], []
        for n in range(N + 1):
            for m in range(n + 1):
                c.append(C.get((n, m), 0.0)); s.append(S.get((n, m), 0.0))
                sc.append(math.hypot(sC.get((n, m), 0.0), sS.get((n, m), 0.0)))
        out = {
            'model': 'GRGM1200A', 'degree': N,
            'gm_km3_s2': GM, 'gm_sigma_km3_s2': sGM, 'r_ref_km': R,
            'normalization': 'fully normalized (geodesy 4-pi), per the PDS label and header NORMALIZATION STATE = 1',
            'frame': 'Moon principal axes (PA) of the DE430 ephemeris, per the PDS label ("The planetary ephemeris used is '
                     'de430 and defines the lunar body-fixed coordinate system in the principal axes frame")',
            'tide_system': 'not stated in the label; the label gives the nominal Love number k2 = 0.024133 +/- 0.000010 '
                           '(no tide model is applied in src/prop.js)',
            'order': 'C and S listed by degree n = 0..N, then order m = 0..n (index n(n+1)/2 + m); C00 = 1, degree 1 = 0',
            'source': {
                'product': 'GRAIL-L-LGRS-5-RDR-V1.0, PRODUCT_ID GGGRX_1200A_SHA.TAB (ORIGINAL_PRODUCT_ID GRGM1200A), '
                           'released 2016-04-01, GSFC Level-2 team',
                'url': GRAV_BASE + GRAV_TAB, 'label': GRAV_BASE + GRAV_LBL,
                'reference': 'Lemoine et al. 2014, GRL, doi:10.1002/2014GL060027 (named in the label)',
                'read': 'bytes 0-%d by HTTP range request on %s; the file holds degree/order %d (header)' % (
                    GRAV_BYTES - 1, datetime.now(timezone.utc).strftime('%Y-%m-%d'), deg),
                'gm_note': 'GM is the header-record value of the coefficient file (%r). The label text prints GM = %s '
                           'km^3/s^2; the two differ by %.1e relative. The header value is the one the coefficients '
                           'are paired with in the file.' % (GM, label_gm, abs(GM - float(label_gm)) / GM),
            },
            'C': c, 'S': s,
        }
        if keep_sigma:
            out['sigma_CS'] = sc
        return out

    if gmax > nmax_have or gref > nmax_have:
        raise SystemExit('downloaded part holds degrees to %d only' % nmax_have)
    p = os.path.join(ROOT, 'data', 'gravity.json')
    json.dump(pack(gmax, False), open(p, 'w'), separators=(',', ':'))
    print('wrote', p, os.path.getsize(p), 'bytes, degree', gmax)
    os.makedirs(TD, exist_ok=True)
    q = os.path.join(TD, 'gravity_ref.json')
    json.dump(pack(gref, True), open(q, 'w'), separators=(',', ':'))
    print('wrote', q, os.path.getsize(q), 'bytes, degree', gref)


# ------------------------------------------------------------------ Horizons
def spice():
    import spiceypy as sp
    sp.kclear()
    sp.furnsh(os.path.join(KDIR, 'naif0012.tls'))
    return sp


def utc_ms_to_jd_tdb(sp, ms):
    et = sp.str2et(datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'))
    return 2451545.0 + et / 86400.0


def jd_tdb_to_utc_ms(sp, jd):
    et = (jd - 2451545.0) * 86400.0
    s = sp.et2utc(et, 'ISOC', 6)
    return datetime.strptime(s, '%Y-%m-%dT%H:%M:%S.%f').replace(tzinfo=timezone.utc).timestamp() * 1000.0


def horizons(hid, jd0, jd1, step='1h'):
    p = {'format': 'text', 'COMMAND': "'%s'" % hid, 'OBJ_DATA': "'YES'", 'MAKE_EPHEM': "'YES'", 'EPHEM_TYPE': "'VECTORS'",
         'CENTER': "'500@301'", 'REF_PLANE': "'FRAME'", 'REF_SYSTEM': "'ICRF'", 'VEC_TABLE': "'2'", 'OUT_UNITS': "'KM-S'",
         'CSV_FORMAT': "'YES'", 'VEC_LABELS': "'NO'", 'START_TIME': "'JD %.9f'" % jd0, 'STOP_TIME': "'JD %.9f'" % jd1,
         'STEP_SIZE': "'%s'" % step}
    return get(API + '?' + urllib.parse.urlencode(p)).decode()


def parse_header(txt):
    head = txt.split('$$SOE')[0]
    out = {}
    m = re.search(r'Ephemeris / \S+ (.+?) Pasadena', head)
    out['query_date'] = m.group(1).strip() if m else None
    m = re.search(r'Target body name:\s*(.+?)\s*\{source:\s*([^}]+)\}', head)
    out['target'] = m.group(1).strip() if m else None
    out['source'] = m.group(2).strip() if m else None
    m = re.search(r'Center body name:.*\{source:\s*([^}]+)\}', head)
    out['center_source'] = m.group(1).strip() if m else None
    m = re.search(r'Revised:\s*(\w+ \d+, \d{4})', head)
    out['revised'] = m.group(1) if m else None
    # trajectory block: from the "TRAJECTORY" heading to the end of the object-data box
    m = re.search(r'TRAJECTORY[^\n]*\n(.*?)\n\*{20,}', head, re.S)
    out['trajectory_text'] = re.sub(r'[ \t]+', ' ', m.group(1)).strip() if m else None
    m = re.search(r'Reference frame\s*:\s*([^\n]+)', head)
    out['frame'] = m.group(1).strip() if m else None
    m = re.search(r'Output units\s*:\s*([^\n]+)', head)
    out['units'] = m.group(1).strip() if m else None
    return out


def fetch(force=False):
    sp = spice()
    os.makedirs(TD, exist_ok=True)
    for s in SATS:
        spans = list(s['spans'])
        if s['builtin']:
            spans.append(('acc', '2026-11-14', 4 / 24.0, '720'))   # 4 h at 20 s: acceleration check
        for sp_ in spans:
            tag, day, nd = sp_[:3]
            step = sp_[3] if len(sp_) > 3 else '1h'
            raw = os.path.join(TD, 'horizons_%s_%s.txt' % (s['id'], tag))
            if force or not os.path.exists(raw):
                t0 = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp() * 1000
                jd0 = utc_ms_to_jd_tdb(sp, t0)
                txt = horizons(s['hid'], jd0, jd0 + nd, step)
                if '$$SOE' not in txt:
                    print('NO TABLE', s['id'], tag, txt[-600:])
                    continue
                open(raw, 'w', encoding='utf-8', newline='\n').write(txt)
                time.sleep(1)
            txt = open(raw, encoding='utf-8').read()
            hd = parse_header(txt)
            assert 'Moon' in txt.split('Center body name:')[1].split('\n')[0]
            assert hd['frame'].startswith('ICRF') and hd['units'].startswith('KM-S'), (hd['frame'], hd['units'])
            body = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
            t, r, v = [], [], []
            for ln in body:
                f = [x.strip() for x in ln.split(',')]
                jd = float(f[0])
                t.append(round(jd_tdb_to_utc_ms(sp, jd), 3))
                r += [float(x) for x in f[2:5]]
                v += [float(x) for x in f[5:8]]
            out = dict(id=s['id'], horizons_id=s['hid'], span=tag, header=hd, n=len(t), t_ms=t, r=r, v=v,
                       time_note='Horizons TDB Julian dates converted to UTC with SPICE et2utc (naif0012.tls)')
            p = os.path.join(TD, 'truth_%s_%s.json' % (s['id'], tag))
            json.dump(out, open(p, 'w'), separators=(',', ':'))
            print('%-14s %-4s %4d rows %s .. %s  source %s' % (s['id'], tag, len(t), iso(t[0]), iso(t[-1]), hd['source']))


def spice_reference():
    """Reference values for the checks in tests/check_prop.js, from SPICE with the kernels the page's ephemeris uses:
    Earth and Sun from the Moon's centre (J2000 = ICRF axes, geometric 'NONE'), the rotation J2000 -> MOON_PA
    (DE440 PA, moon_pa_de440_200625.bpc) and the constant MOON_PA -> MOON_ME rotation (moon_de440_250416.tf)."""
    import spiceypy as sp
    sp.kclear()
    for f in ('naif0012.tls', 'de440s.bsp', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf'):
        sp.furnsh(os.path.join(KDIR, f))
    rows = []
    t = datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    while t < datetime(2028, 1, 1, tzinfo=timezone.utc).timestamp() * 1000:
        et = sp.str2et(datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'))
        e, _ = sp.spkpos('EARTH', et, 'J2000', 'NONE', 'MOON')
        s, _ = sp.spkpos('SUN', et, 'J2000', 'NONE', 'MOON')
        m = sp.pxform('J2000', 'MOON_PA', et)
        rows.append(dict(t_ms=t, earth=list(e), sun=list(s), icrf_to_pa=[list(x) for x in m]))
        t += 37.3 * 86400000  # irregular spacing so the samples fall at all phases of the month
    pa_me = sp.pxform('MOON_PA', 'MOON_ME', 0.0)
    out = dict(note='SPICE (spiceypy) with naif0012.tls, de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf',
               pa_to_me=[list(x) for x in pa_me], rows=rows)
    p = os.path.join(TD, 'spice_ref.json')
    json.dump(out, open(p, 'w'), indent=0)
    print('wrote', p, len(rows), 'epochs')


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ------------------------------------------------------------------ catalogue
def node():
    n = shutil.which('node')
    if n:
        return n
    for c in (r'C:\Program Files\nodejs\node.exe', '/usr/bin/node', '/usr/local/bin/node'):
        if os.path.exists(c):
            return c
    raise SystemExit('node not found')


def osculating(r, v, gm, rm):
    rn = math.sqrt(sum(x * x for x in r)); v2 = sum(x * x for x in v)
    a = 1 / (2 / rn - v2 / gm)
    h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]]
    hn = math.sqrt(sum(x * x for x in h))
    e = math.sqrt(max(0.0, 1 - hn * hn / (gm * a)))
    return dict(a_km=a, e=e, peri_alt_km=a * (1 - e) - rm, apo_alt_km=a * (1 + e) - rm,
                period_h=2 * math.pi * math.sqrt(a ** 3 / gm) / 3600, inc_icrf_deg=math.degrees(math.acos(h[2] / hn)))


DEFAULT_ON = ('lro', 'chandrayaan2')
NOTES = {
    'danuri': 'The Horizons Danuri trajectory carries an acceleration of about 33 um/s^2 that the model does not have, '
              'nearly constant and pointing at the Sun (cosine 0.999; tests/check_prop.js section H); LRO and Chandrayaan-2 '
              'show no such term. Its cause is not identified, so Danuri errors grow about 25 times faster than those of LRO.',
    'lro': 'The departure from 2026-12-10 13:00 UTC (1-4 km per hour for more than a day) is inside the Horizons '
           'prediction and looks like planned manoeuvres; no force model reproduces it.',
}


def catalogue(skip_node=False):
    if not skip_node:
        env = dict(os.environ)
        subprocess.run([node(), os.path.join(ROOT, 'tests', 'check_prop.js')], cwd=ROOT, check=False, env=env)
    res = json.load(open(os.path.join(ROOT, 'tests', 'out', 'check_prop.json')))
    grav = json.load(open(os.path.join(ROOT, 'data', 'gravity.json')))
    gm = grav['gm_km3_s2']
    RM = 1737.4  # mean radius used by the page (src/core.js) for altitudes
    sats, excluded = [], []
    for s in SATS:
        spans = [x for x in s['spans'] if os.path.exists(os.path.join(TD, 'truth_%s_%s.json' % (s['id'], x[0])))]
        if not spans:
            continue
        tag = spans[0][0]
        tr = json.load(open(os.path.join(TD, 'truth_%s_%s.json' % (s['id'], tag))))
        r, v = tr['r'][:3], tr['v'][:3]
        osc = osculating(r, v, gm, RM)
        R = res['sats'].get(s['id'], {})
        entry = dict(
            id=s['id'], name=s['name'], horizons_id=s['hid'], about=s['about'], builtin=s['builtin'],
            epoch_ms=tr['t_ms'][0], epoch_utc=iso(tr['t_ms'][0]), r=r, v=v,
            frame='Moon-centred ICRF (J2000 Earth-equator axes), km and km/s',
            osculating_at_epoch=dict((k, round(x, 4)) for k, x in osc.items()),
            altitude_range_30d_km=R.get('alt_range_km'),
            horizons=dict(target=tr['header']['target'], solution=tr['header']['source'], revised=tr['header']['revised'],
                          query_date=tr['header']['query_date'], trajectory=tr['header']['trajectory_text'],
                          truth_end_utc=iso(tr['t_ms'][-1])),
            default_degree=R.get('default_degree'),
            error_vs_horizons=R.get('default_errors'),
            error_note=R.get('note'),
        )
        # longest span compared with Horizons, and one line for the page
        days = []
        for x in spans:
            t2 = json.load(open(os.path.join(TD, 'truth_%s_%s.json' % (s['id'], x[0]))))
            days.append((t2['t_ms'][-1] - t2['t_ms'][0]) / 86400000.0)
        entry['checked_days'] = round(max(days))
        e = entry['error_vs_horizons'] or {}
        def km(x):
            return ('%.2f' % x) if x < 1 else ('%.1f' % x) if x < 10 else ('%.0f' % x)
        parts = ['%s km after %s' % (km(e[k]['pos_km']), w) for k, w in (('1d', '1 day'), ('7d', '7 days')) if k in e]
        late = e.get('7d', {}).get('late_s')
        entry['check_text'] = 'Against JPL Horizons from %s: %s%s' % (
            entry['epoch_utc'][:10], ', '.join(parts), ' (%.1f s along-track)' % abs(late) if late is not None else '')
        entry['default_on'] = s['id'] in DEFAULT_ON
        # two-body and the default model only (the degree scan is in tests/out/check_prop.json)
        entry['error_tables'] = {sp: dict(start_utc=A['start_utc'], end_utc=A['end_utc'],
                                          configs={k: c for k, c in A['configs'].items() if k == 'two-body' or k.startswith('default N=')})
                                 for sp, A in res['accuracy'].get(s['id'], {}).items()}
        if s['id'] in NOTES:
            entry['error_note'] = ((entry['error_note'] + ' ') if entry['error_note'] else '') + NOTES[s['id']]
        if not s['builtin']:
            entry['reason'] = ('Horizons trajectory ends 2026-08-14 (header: completed mission, no further updates), so there is '
                               'no state near 2026-11-14. Used only to validate the propagator on a near-rectilinear halo orbit.')
            excluded.append(entry)
            continue
        sats.append(entry)
    out = dict(
        generated_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        source='JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), vector tables, CENTER=500@301, ICRF, KM-S',
        propagator=res.get('info'),
        error_definition=res.get('error_definition'),
        default_on_rule='default_on for the two spacecraft whose Horizons trajectory covers 2026-11-14 and whose propagation '
                        'holds best against it over 7 days (Chandrayaan-2 0.24 km, LRO 0.98 km)',
        sats=sats, not_included=excluded)
    p = os.path.join(ROOT, 'data', 'sats.json')
    json.dump(out, open(p, 'w'), indent=1)
    print('wrote', p, os.path.getsize(p), 'bytes,', len(sats), 'spacecraft')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='all', choices=['gravity', 'fetch', 'catalogue', 'all'])
    ap.add_argument('--gmax', type=int, default=100, help='degree written to data/gravity.json')
    ap.add_argument('--gref', type=int, default=150, help='degree written to tests/data/gravity_ref.json')
    ap.add_argument('--refetch', action='store_true')
    ap.add_argument('--skip-node', action='store_true')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    if a.stage in ('gravity', 'all'):
        gravity(a.gmax, a.gref)
    if a.stage in ('fetch', 'all'):
        fetch(a.refetch)
        spice_reference()
    if a.stage in ('catalogue', 'all'):
        catalogue(a.skip_node)
