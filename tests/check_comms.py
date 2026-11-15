"""Validate the relay-satellite code (src/app/12-comms.js) against JPL Horizons, using LRO (-85) as the test object.

Inputs, fetched once into tests/data (re-fetched if missing; needs network then):
  horizons_lro_10m.txt      vector table, Moon centre (500@301), ICRF, KM-S, 2026-11-01 00:00-12:00 TDB, 10 min
  horizons_lro_1m.txt       the same at 1 min (truth for interpolation between 10-min rows)
  horizons_lro_ecl_csv.txt  vector table in the J2000 ecliptic, CSV layout (tests the frame rotation and CSV parsing)
  horizons_lro_elem.txt     osculating elements at 2026-11-01 00:00 TDB, ICRF
  horizons_lro_azel.txt     observer table: LRO azimuth/elevation from Shackleton rim (89.6864 S, 197.0629 E, 0 km)

Checks (all on the built page, dist/lunar-window-browser.html, through window.LWB_COMMS_TEST):
  1. 10-min table interpolated (Hermite with velocities) vs the 1-min table: worst position error.
  2. Ecliptic CSV table vs the ICRF table at the same rows.
  3. Two-body Kepler from the osculating elements vs the 1-min table: error at the epoch (element conversion) and
     its growth over 12 h (what the two-body model leaves out for a low orbit).
  4. Whole chain (table -> body-fixed via IAU rotation -> topocentric az/el at a site) vs Horizons' own az/el.
Writes tests/out/comms_check.json. Exits non-zero if 1, 2 or 4 miss their targets (3 is reported, not a target)."""
import json, math, os, pathlib, sys, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / 'tests' / 'data'; D.mkdir(exist_ok=True)
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
BASE = {'format': 'text', 'COMMAND': "'-85'", 'START_TIME': "'2026-11-01'", 'STOP_TIME': "'2026-11-01 12:00'"}
FILES = {
    'horizons_lro_10m.txt': dict(EPHEM_TYPE="'VECTORS'", CENTER="'500@301'", STEP_SIZE="'10m'", REF_PLANE="'FRAME'", REF_SYSTEM="'ICRF'", VEC_TABLE="'2'", OUT_UNITS="'KM-S'"),
    'horizons_lro_1m.txt': dict(EPHEM_TYPE="'VECTORS'", CENTER="'500@301'", STEP_SIZE="'1m'", REF_PLANE="'FRAME'", REF_SYSTEM="'ICRF'", VEC_TABLE="'2'", OUT_UNITS="'KM-S'"),
    'horizons_lro_ecl_csv.txt': dict(EPHEM_TYPE="'VECTORS'", CENTER="'500@301'", STEP_SIZE="'10m'", REF_SYSTEM="'ICRF'", VEC_TABLE="'2'", CSV_FORMAT="'YES'"),
    'horizons_lro_elem.txt': dict(EPHEM_TYPE="'ELEMENTS'", CENTER="'500@301'", STEP_SIZE="'1m'", REF_PLANE="'FRAME'", REF_SYSTEM="'ICRF'", OUT_UNITS="'KM-S'", STOP_TIME="'2026-11-01 00:01'"),
    'horizons_lro_azel.txt': dict(EPHEM_TYPE="'OBSERVER'", CENTER="'coord@301'", COORD_TYPE="'GEODETIC'", SITE_COORD="'197.0629,-89.6864,0'", STEP_SIZE="'20m'", QUANTITIES="'4'", APPARENT="'AIRLESS'", ANG_FORMAT="'DEG'", TIME_TYPE="'UT'"),
}
for name, q in FILES.items():
    if not (D / name).exists():
        p = dict(BASE); p.update(q)
        (D / name).write_text(urllib.request.urlopen(API + '?' + urllib.parse.urlencode(p), timeout=90).read().decode())
txt = {k: (D / k).read_text() for k in FILES}

# first row of the 1-min table -> page two-body record (a state vector, as the page takes it)
r0 = txt['horizons_lro_1m.txt'].split('$$SOE')[1]
def g(k): return float(r0.split(k + '=')[1].split()[0])
jd = float(r0.split()[0])
kep = {'kind': 'kep', 'name': 'LRO two-body', 'r': [g(' X '), g(' Y '), g(' Z ')], 'v': [g('VX'), g('VY'), g('VZ')],
       'epoch': round((jd - 2440587.5) * 86400000 - 69184), 'frame': 'icrf', 'minEl': 0, 'on': True}
# Horizons' own osculating elements at that epoch, to check the state -> ellipse conversion
el = txt['horizons_lro_elem.txt'].split('$$SOE')[1]
def ge(k): return float(el.split(k + '=')[1].split()[0])
hz_el = {'QR': ge('QR'), 'AD': ge('AD'), 'IN': ge('IN'), 'PR_s': ge('PR')}
# observer az/el rows (UT)
rows = []
for line in txt['horizons_lro_azel.txt'].split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
    f = line.split()
    rows.append((f[0] + ' ' + f[1], float(f[-2]), float(f[-1])))
URL = (ROOT / 'dist' / 'lunar-window-browser.html').as_uri()
AE = str(ROOT / 'node_modules' / 'astronomy-engine' / 'astronomy.browser.min.js')
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.route('**/astronomy.browser.min.js', lambda r: r.fulfill(path=AE, content_type='application/javascript'))
    pg.route('**/fonts.*/**', lambda r: r.abort())
    pg.goto(URL); pg.wait_for_function('window.LWB_BOOT_MS > 0', timeout=120000)
    res = pg.evaluate('''([t10, t1, tecl, kep, rows]) => {
      const C = window.LWB_COMMS_TEST, H10 = C.parseHorizons(t10), H1 = C.parseHorizons(t1), HE = C.parseHorizons(tecl);
      const s10 = C.satOf({kind:'tab', name:'t', t:H10.t, p:H10.p, v:H10.v, minEl:0}), sk = C.satOf(kep);
      const s10lin = C.satOf({kind:'tab', name:'t', t:H10.t, p:H10.p, v:null, minEl:0});
      const d = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
      let interp = 0, lin = 0, ecl = 0, kep0 = null, kepErr = [];
      for (let i = 0; i < H1.t.length; i++) {
        const truth = [H1.p[3*i], H1.p[3*i+1], H1.p[3*i+2]];
        const a = C.satICRF(s10, H1.t[i]); if (a) interp = Math.max(interp, d(a, truth));
        const l = C.satICRF(s10lin, H1.t[i]); if (l) lin = Math.max(lin, d(l, truth));
        const k = C.satICRF(sk, H1.t[i]), e = d(k, truth);
        if (i === 0) kep0 = e;
        if (i % 60 === 0) kepErr.push([Math.round((H1.t[i] - H1.t[0]) / 3600000), +e.toFixed(2)]);
      }
      for (let i = 0; i < HE.t.length; i++) { const j = H10.t.indexOf(HE.t[i]); if (j >= 0) ecl = Math.max(ecl, d([HE.p[3*i],HE.p[3*i+1],HE.p[3*i+2]], [H10.p[3*j],H10.p[3*j+1],H10.p[3*j+2]])); }
      const site = LWB.makeSite(-89.6864, 197.0629 - 360, 0, null, 0), t = {}, M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let azel = 0, n = 0, worst = null;
      rows.forEach(r => {
        const m = r[0].match(/(\\d+)-(\\w+)-(\\d+) (\\d+):(\\d+)/), ms = Date.UTC(+m[1], M.indexOf(m[2]), +m[3], +m[4], +m[5]);
        const pm = C.satME(s10, ms); if (!pm) return;
        LWB.topo(site, pm, t);
        const dz = Math.abs(((t.az - r[1] + 540) % 360) - 180) * Math.cos(r[2] * Math.PI / 180), de = Math.abs(t.el - r[2]), dd = Math.max(dz, de);
        n++; if (dd > azel) { azel = dd; worst = [r[0], r[1], r[2], +t.az.toFixed(4), +t.el.toFixed(4)]; }
      });
      return { notes: [H10.note, HE.note], interp_max_km: interp, linear_max_km: lin, ecliptic_vs_icrf_max_km: ecl, kepler_epoch_err_km: kep0, kepler_err_km_by_hour: kepErr,
               derived: { QR: sk.a * (1 - sk.e), AD: sk.a * (1 + sk.e), IN: sk.inc, PR_s: sk.periodH * 3600 }, azel_samples: n, azel_max_deg: azel, azel_worst: worst };
    }''', [txt['horizons_lro_10m.txt'], txt['horizons_lro_1m.txt'], txt['horizons_lro_ecl_csv.txt'], kep, rows])
    # 5. end to end on the far side (Chang'e-4): no direct Earth link, so any link is through the relay.
    #    A 200 x 8000 km orbit with apoapsis over the south, entered through the Satellites form like a user would (two-body).
    pg2 = b.new_page()
    pg2.route('**/astronomy.browser.min.js', lambda r: r.fulfill(path=AE, content_type='application/javascript'))
    pg2.route('**/fonts.*/**', lambda r: r.abort())
    pg2.goto(URL + '#s=ce4&t=2027-03-05T12:00Z'); pg2.wait_for_function('window.LWB_READY_MS > 0', timeout=120000)
    tile = '[...document.querySelectorAll("#vStats tr")].map(r => r.cells[0].textContent + " " + r.cells[1].textContent).filter(t => /^(Earth link|Link \()/.test(t))[0]'
    far0 = pg2.evaluate(tile)
    # periapsis 200 km over the Moon's north pole, apoapsis 8000 km over the south: r = (0, 0, 1937.4) km,
    # v = sqrt(GM (2/r - 1/a)) = 2.0546 km/s along +x, Moon-equator axes
    pg2.click('#satAdd summary'); pg2.select_option('#satKind', 'kep'); pg2.fill('#satName', 'Far relay')
    for k, v in (('satX', '0'), ('satY', '0'), ('satZ', '1937.4'), ('satVX', '2.0546'), ('satVY', '0'), ('satVZ', '0')): pg2.fill('#' + k, v)
    pg2.select_option('#satFrame', 'moon'); pg2.click('#satForm button[type=submit]'); pg2.wait_for_timeout(4000)
    res['far_side_sat'] = pg2.inner_text('#satList')
    far1 = pg2.evaluate(tile)
    # independent recount of the link fraction from the page's own arrays: relay steps over the statistics period
    rec = pg2.evaluate('''(() => { const X = LWB_COMMS_TEST.state(), s = X.SITES[X.S.sel], i0 = Math.round((X.S.tMs - X.S.startMs) / 600000), n = X.S.horizonD * 144;
      let r = 0, d = 0, okE = 0, chk = 0, bad = 0, t = {}; const C = X.STEPS.comms;
      for (let i = i0; i < i0 + n; i++) { if (s.relay[i] >= 0) r++; if (s.earthMar[i] >= 0) d++; }
      // re-test 200 relay steps directly: satellite above the skyline and Earth not hidden by the Moon
      for (let i = i0; i < i0 + n && chk < 200; i += 7) { const p = [C.pos[i*3], C.pos[i*3+1], C.pos[i*3+2]], e = [X.STEPS.earth[i*3], X.STEPS.earth[i*3+1], X.STEPS.earth[i*3+2]];
        if (!isFinite(p[0])) continue; chk++; LWB.topo(s.geo, p, t); const vis = t.el - LWB.horizonAt(s.geo, t.az) >= 0 && LWB_COMMS_TEST.clearOfMoon(p, e);
        if (vis !== (s.relay[i] >= 0)) bad++; }
      return { relay_steps: r, direct_steps: d, n: n, rechecked: chk, mismatches: bad }; })()''')
    res['far_side'] = {'before': far0, 'after': far1, **rec}
    res['clear_of_moon_unit'] = pg2.evaluate('[LWB_COMMS_TEST.clearOfMoon([0,0,3000],[384000,0,0]), LWB_COMMS_TEST.clearOfMoon([-3000,0,0],[384000,0,0]), LWB_COMMS_TEST.clearOfMoon([0,1800,0],[384000,0,0])]')
    b.close()
print(json.dumps(res, indent=1))
json.dump(res, open(ROOT / 'tests' / 'out' / 'comms_check.json', 'w'), indent=1)
# 1: cubic Hermite on 10-min rows of a 1.95 h orbit; error scales with the row step to the 4th power.
fs = res['far_side']
res['horizons_elements'] = hz_el
dv = res['derived']
el_ok = abs(dv['QR'] - hz_el['QR']) < 0.01 and abs(dv['AD'] - hz_el['AD']) < 0.01 and abs(dv['IN'] - hz_el['IN']) < 1e-4 and abs(dv['PR_s'] - hz_el['PR_s']) < 0.5
print('state -> ellipse vs Horizons elements:', dv, hz_el, 'ok' if el_ok else 'MISMATCH')
ok = el_ok and fs['direct_steps'] == 0 and fs['relay_steps'] > 0 and fs['mismatches'] == 0 and res['clear_of_moon_unit'] == [True, False, True] and \
     res['interp_max_km'] < 0.5 and res['ecliptic_vs_icrf_max_km'] < 0.01 and res['azel_max_deg'] < 0.05 and res['kepler_epoch_err_km'] < 0.05
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
