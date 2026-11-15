"""Playwright smoke test: load the built page exactly as shipped (dist/lunar-window-browser.html, no wrapper),
walk through the three views, screenshot, and report console errors.
Exits non-zero on any console error, page error or failed assertion.  Usage: python tests/screenshot.py [outdir] [--no-helper]

If data/raw is present the terrain helper (tools/terrain/serve.py) is started on port 8791 and the custom-site
and on-demand grid flows are tested against it; otherwise those parts are skipped and the script says so."""
import sys, os, pathlib, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
S = str(ROOT / 'tests' / 'out')
os.makedirs(S, exist_ok=True)
AE = str(ROOT / 'node_modules' / 'astronomy-engine' / 'astronomy.browser.min.js')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = args[0] if args else S
URL = (ROOT / 'dist' / 'lunar-window-browser.html').as_uri()
errs = []
raw = open(ROOT / 'dist' / 'lunar-window-browser.html', 'rb').read()
assert raw.lstrip().lower().startswith(b'<!doctype html>') and b'<meta charset="utf-8">' in raw[:400], 'the page must declare its own doctype and charset'

helper = None
if (ROOT / 'data' / 'raw' / 'LDEM_80S_20MPP_ADJ.TIF').exists() and '--no-helper' not in sys.argv:
    helper = subprocess.Popen([sys.executable, '-u', str(ROOT / 'tools' / 'terrain' / 'serve.py')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in helper.stdout:
        if 'ready' in line:
            break
    print('helper:', json.loads(urllib.request.urlopen('http://127.0.0.1:8791/ping').read())['service'])
else:
    print('helper: not started, custom-terrain and on-demand grid tests skipped')

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        def page_for(w, h, mobile=False, frag='', url=URL, wait='window.LWB_READY_MS > 0'):
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1 if not mobile else 2, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
            pg = ctx.new_page()
            # fonts are blocked on purpose; a refused helper probe is expected when the helper is not running
            # 'GPU stall due to ReadPixels': headless Chrome's software WebGL when the harness screenshots the 3D canvas
            quiet = ('net::ERR_FAILED', 'GPU stall due to ReadPixels') + (() if helper else ('ERR_CONNECTION_REFUSED',))
            pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and not any(q in m.text for q in quiet) else None)
            pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            pg.route('**/astronomy.browser.min.js', lambda r: r.fulfill(path=AE, content_type='application/javascript'))
            pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
            pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
            pg.goto(url + frag)
            pg.wait_for_function(wait, timeout=120000)
            print('(%dx%d) script boot %d ms, all sites ready %d ms' % (w, h, pg.evaluate('window.LWB_BOOT_MS'), pg.evaluate('window.LWB_READY_MS')))
            pg.wait_for_timeout(1500)
            return pg
        def txt(pg, sel): return pg.inner_text(sel).replace('\n', ' | ')
        def view(pg, v): pg.click('.views [data-view="%s"]' % v); pg.wait_for_timeout(700)

        # ---------- view 1: one site ----------
        pg = page_for(1440, 900, frag='#s=ridge&t=2027-03-05T12:00Z')
        body = pg.inner_text('body')
        assert 'Â' not in body and '�' not in body, 'mis-decoded characters on the page'
        assert pg.evaluate('document.documentElement.getAttribute("data-theme")') == 'light'
        pg.screenshot(path=out + '/d1_site_hero.png')
        pg.screenshot(path=out + '/d1_site_full.png', full_page=True)
        hero = pg.locator('.hero').bounding_box()
        print('hero: %d x %d of 1440 x 900' % (hero['width'], hero['height']))
        assert 480 <= hero['height'] <= 900 - 52 - 40, 'the sky should be large but leave the next section in view, so the page reads as scrollable'
        print('stats:', txt(pg, '#vStats'))
        print('state:', txt(pg, '#vState'), '|', txt(pg, '#heroNow'))
        print('hud:', txt(pg, '#hud'))
        print('reason:', txt(pg, '#vReason'))
        print('now:', txt(pg, '#vNow'))
        print('assume:', txt(pg, '#vAssume'))
        pg.click('details.why summary'); pg.wait_for_timeout(1500)
        print('details:', txt(pg, '#vWhy'))
        assert 'Skyline scatter across 16' in txt(pg, '#vTerrUnc'), 'terrain uncertainty not stated'
        print('uncertainty:', txt(pg, '#uHead')[:120], '|', txt(pg, '#uTable'))
        assert 'Across 16 clones' in txt(pg, '#uTable'), 'clone ranges not shown'
        pg.locator('#sec-unc').screenshot(path=out + '/d2c_uncertainty.png')
        # landing-date slip: the dial-time row (hourly series) must agree with the headline tile (10-min steps)
        import re
        slip0 = pg.locator('#slipTable tr[data-t]').nth(0).inner_text().replace('\n', ' ').replace('\t', ' | ')
        print('slip rows:', pg.locator('#slipTable tr[data-t]').count(), '| dial time:', slip0, '| +7 d:', pg.locator('#slipTable tr[data-t]').nth(5).inner_text().replace('\n', ' ').replace('\t', ' | '))
        tile_irr = int(re.sub(r'[^\d]', '', pg.inner_text('#vNow .tile.period .big').split('W')[0]))
        slip_irr = int(re.sub(r'[^\d]', '', slip0.split('|')[1].split('W')[0]))
        print('slip check: tile mean %d W/m2 (10-min steps) vs slip table %d W/m2 (hourly), difference %d' % (tile_irr, slip_irr, abs(tile_irr - slip_irr)))
        assert abs(tile_irr - slip_irr) <= 10, 'the slip table disagrees with the headline mean irradiance'
        pg.wait_for_function('document.getElementById("slipRead").textContent.indexOf("Landing between") === 0', timeout=30000)
        print('slip chart:', txt(pg, '#slipRead'))
        pg.locator('#sec-slip').screenshot(path=out + '/d2a_slip.png')
        pg.click('#slipTable tr[data-t] >> nth=5'); pg.wait_for_timeout(800)
        assert '2027 Mar 12' in txt(pg, '#tLabel'), 'a slip row should move the dial'
        pg.fill('#tDate', '2027-03-05'); pg.dispatch_event('#tDate', 'change'); pg.wait_for_timeout(800)
        assert '2027 Mar 5 12:00' in ' '.join(pg.inner_text('#tLabel').split()), 'the date box should move the dial and keep the time of day: ' + pg.inner_text('#tLabel')
        assert pg.locator('#siteSel option[value="add"]').count() == 1
        pg.locator('section[aria-labelledby="hzH"]').screenshot(path=out + '/d2_skyline.png')
        print('hzNote:', txt(pg, '#hzNote'))
        # polar sky plot
        pg.evaluate('window.scrollTo(0,0)'); pg.click('#modePolar'); pg.wait_for_timeout(600)
        pg.screenshot(path=out + '/d3_polar_plot.png')
        print('polar plot:', txt(pg, '#polarRead'), '| hash', pg.evaluate('location.hash'))
        # 3D terrain and the imagery layer
        pg.click('#mode3d'); pg.wait_for_function('document.getElementById("t3Read").textContent.indexOf("LOLA") === 0', timeout=30000); pg.wait_for_timeout(600)
        pg.screenshot(path=out + '/d3c_terrain3d.png')
        print('3d:', txt(pg, '#t3Read'), '| hash', pg.evaluate('location.hash'))
        chk = pg.evaluate('window.LWB_T3CHECK()'); print('3d centre node vs page skyline:', chk)
        assert chk and chk['agree'] >= 0.9 * chk['samples'], '3D shading disagrees with the page skyline at the site'
        pg.click('#t3Surf [data-surf="img"]'); pg.wait_for_timeout(600); pg.screenshot(path=out + '/d3d_terrain3d_image.png')
        pg.click('#t3Surf [data-surf="sun"]')
        pg.click('#modeSky'); pg.wait_for_timeout(400)
        pg.locator('#sec-maps').screenshot(path=out + '/d2e_maps_imagery.png')
        pg.click('[data-look="sun"]'); pg.wait_for_timeout(900); pg.screenshot(path=out + '/d4_sun.png')
        pg.click('[data-look="earth"]'); pg.wait_for_timeout(900); pg.screenshot(path=out + '/d5_earth.png')
        # limits drawer
        pg.click('#limBtn'); pg.wait_for_timeout(300)
        pg.select_option('#sunFrac', '0.5'); pg.fill('#linkMin', '2'); pg.dispatch_event('#linkMin', 'change'); pg.wait_for_timeout(800)
        pg.screenshot(path=out + '/d6_limits.png')
        print('with limits:', txt(pg, '#limBtn'), '|', txt(pg, '#vState'), '-', txt(pg, '#vReason'))
        pg.check('#ground'); pg.wait_for_timeout(3000)
        print('with DSN:', txt(pg, '#vReason'))
        pg.uncheck('#ground'); pg.wait_for_timeout(3000)
        # relay satellite: a user-entered two-body orbit, apoapsis over the south pole
        frac0 = pg.evaluate('document.querySelector("#vNow .period .sub").textContent')
        # periapsis 500 km over the north pole, apoapsis 8000 km over the south (Moon-equator axes)
        pg.click('#satAdd summary'); pg.fill('#satName', 'Test relay')
        for k, v in (('satX', '0'), ('satY', '0'), ('satZ', '2237.4'), ('satVX', '1.8878'), ('satVY', '0'), ('satVZ', '0')): pg.fill('#' + k, v)
        pg.select_option('#satFrame', 'moon'); pg.click('#satForm button[type=submit]'); pg.wait_for_timeout(3500)
        frac1 = pg.evaluate('document.querySelector("#vNow .period .sub").textContent')
        print('relay: without |', frac0, '| with |', frac1, '|', txt(pg, '#satList'))
        assert 'Link (direct or relay)' in frac1, 'the period tile should name the relay link'
        pct_of = lambda s: int(s.split(' ')[-1].replace('%', '').replace('>', '').replace('<', ''))
        assert pct_of(frac1) >= pct_of(frac0), 'a relay can only add link time'
        pg.locator('#drawer').screenshot(path=out + '/d6b_comms.png')
        pg.click('#satList [data-delsat="0"]'); pg.wait_for_timeout(3000)
        assert pg.evaluate('document.querySelector("#vNow .period .sub").textContent') == frac0, 'removing the relay should restore the numbers'
        before = txt(pg, '#vReason') + txt(pg, '#vNow')
        pg.click('#adv summary')
        for cid in ['optLines', 'optNames', 'optGrid']:
            pg.check('#' + cid); pg.wait_for_timeout(200)
        pg.wait_for_timeout(1200)
        assert txt(pg, '#vReason') + txt(pg, '#vNow') == before, 'a display-only option changed a number'
        print('display-only options leave every number unchanged')
        pg.select_option('#sunFrac', '0'); pg.fill('#linkMin', '0'); pg.dispatch_event('#linkMin', 'change')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
        assert not pg.locator('#drawer').is_visible()
        # dark theme
        pg.click('#themeBtn'); pg.wait_for_timeout(700); pg.screenshot(path=out + '/d7_site_dark.png', full_page=True)
        pg.click('#themeBtn'); pg.wait_for_timeout(500)
        # another kind of site, playback, export
        pg.select_option('#siteSel', label='Apollo 11, Tranquility Base') if pg.locator('#siteSel option', has_text='Apollo 11').count() else None
        pg.wait_for_timeout(1000)
        print('apollo 11:', txt(pg, '#heroNow'))
        pg.click('#play'); pg.wait_for_timeout(1200); pg.click('#play')
        pg.click('#modePolar'); pg.wait_for_timeout(500); pg.screenshot(path=out + '/d3b_polar_plot_midlat.png'); pg.click('#modeSky')
        with pg.expect_download() as dl:
            pg.click('#csvBtn')
        head = pg.input_value('#csvOut')
        assert 'irradiance_w_m2' in head
        print('csv:', dl.value.suggested_filename, '|', head.splitlines()[-2], '|', head.splitlines()[-1])

        # ---------- view 3: the list ----------
        pg.select_option('#siteSel', index=0); pg.wait_for_timeout(600)
        pg.click('#pinBtn'); pg.wait_for_timeout(300)
        view(pg, 'list'); pg.wait_for_timeout(2500)
        pg.screenshot(path=out + '/d8_list.png', full_page=True)
        rows = pg.locator('#listTable tr[data-i]').count()
        print('list rows:', rows, '|', txt(pg, '#listWhen'))
        print('list first rows:', ' // '.join(pg.locator('#listTable tr[data-i]').nth(i).inner_text().replace('\n', ' ').replace('\t', ' | ') for i in range(3)))
        pg.click('#listTable th[data-k="irr"]'); pg.wait_for_timeout(300)
        print('sorted by mean irradiance, top:', pg.locator('#listTable tr[data-i]').nth(0).inner_text().replace('\n', ' ').replace('\t', ' | ')[:160])
        pg.click('#listTable th[data-k="irr"]'); pg.click('#listTable th[data-k="irr"]'); pg.wait_for_timeout(200)
        pg.click('#addBtn'); pg.wait_for_timeout(1800)
        pg.fill('#bulk', 'Mid A, -30, 100\nNear the ridge, -89.4540, 222.90\nbad line\nAway from any site; -87.2; 70.0'); pg.click('#bulkOk'); pg.wait_for_timeout(7000)
        print('bulk add:', txt(pg, '#addHint')[:120], '| rows now', pg.locator('#listTable tr[data-i]').count())
        assert pg.locator('#listTable tr[data-i]').count() == rows + 3
        pg.locator('section[aria-labelledby="listH"]').screenshot(path=out + '/d9_list_custom.png')
        with pg.expect_download() as dl:
            pg.click('#listCsv')
        print('list csv:', dl.value.suggested_filename)
        for _ in range(3):
            pg.click('#listTable button[data-act="del"] >> nth=0'); pg.wait_for_timeout(500)
        assert pg.locator('#listTable tr[data-i]').count() == rows
        print('year:', txt(pg, '#yrFrom'))
        pg.locator('section[aria-labelledby="yrH"]').screenshot(path=out + '/d10_year.png')
        pg.click('#listTable button[data-act="pin"] >> nth=3'); pg.wait_for_timeout(800)
        print('compare:', txt(pg, '#cmpTable')[:500])
        pg.click('[data-tab="pareto"]'); pg.wait_for_timeout(2500)
        print('pareto sites:', txt(pg, '#pfPick')[:220])
        pg.select_option('#pfMode', 'near'); pg.wait_for_timeout(3000)
        print('pareto near:', txt(pg, '#pfPick')[:220])
        pg.locator('section[aria-labelledby="anH"]').screenshot(path=out + '/d11_pareto.png')
        pg.select_option('#pfMode', 'dates'); pg.wait_for_timeout(2500)
        print('pareto dates:', txt(pg, '#pfPick')[:160])
        box = pg.locator('#year').bounding_box()
        pg.locator('#year').click(position={'x': box['width'] * 0.7, 'y': 26}); pg.wait_for_timeout(1500)
        assert pg.locator('#view-site').is_visible(), 'a click on the year calendar should open the site'
        print('after year click -> site view:', txt(pg, '#vSite'), txt(pg, '#tLabel'), '| view', pg.evaluate('location.hash'))

        # ---------- view 2: find a site ----------
        view(pg, 'find')
        pg.fill('#fStart', '2027-03-05'); pg.dispatch_event('#fStart', 'change')
        pg.wait_for_function('window.LWB_FIND_MS > 0', timeout=120000); pg.wait_for_timeout(600)
        print('survey evaluated; funnel:', txt(pg, '#funnel'))
        pg.screenshot(path=out + '/d12_find_all.png', full_page=True)
        for k, v in [('gIrr', '700'), ('gDark', '150'), ('gEarth', '40'), ('gSlope', '10')]:
            pg.fill('#' + k, v); pg.dispatch_event('#' + k, 'change')
        pg.wait_for_timeout(700)
        print('funnel with goals:', txt(pg, '#funnel'))
        print('top candidates:', ' // '.join(pg.locator('#fTable tr[data-k]').nth(i).inner_text().replace('\t', ' | ') for i in range(min(3, pg.locator('#fTable tr[data-k]').count()))))
        pg.screenshot(path=out + '/d13_find_goals.png', full_page=True)
        pg.fill('#fLat0', '89'); pg.dispatch_event('#fLat0', 'change'); pg.wait_for_timeout(500)
        print('funnel, south of 89S:', txt(pg, '#funnel')[:200])
        pg.fill('#fLat0', ''); pg.dispatch_event('#fLat0', 'change')
        if pg.locator('#fTable tr[data-k]').count():
            pg.click('#fTable tr[data-k] >> nth=0'); pg.wait_for_timeout(2500)
            print('candidate chosen:', txt(pg, '#lpTitle'), '|', txt(pg, '#lpOut')[:260])
            if helper:
                pg.click('#lpCompute'); pg.wait_for_function('window.LWB_LP_MS > 0', timeout=400000); pg.wait_for_timeout(800)
                pg.fill('#lpA', '150'); pg.fill('#lpB', '100'); pg.dispatch_event('#lpB', 'change'); pg.wait_for_timeout(600)
                print('helper grid for a survey point:', txt(pg, '#lpOut'))
                pg.locator('#lpCard').screenshot(path=out + '/d14b_lp_helper.png')
            pg.click('#lpOpen'); pg.wait_for_timeout(2500)
            print('candidate opened in the sky view:', txt(pg, '#vSite'), '|', txt(pg, '#heroNow')[:120], '|', txt(pg, '#vAssume')[:110])
            pg.screenshot(path=out + '/d15_candidate_sky.png')
            pg.click('#removeSite'); pg.wait_for_timeout(600)
            view(pg, 'find')
        # landing precision at a listed site, from the Site view button
        view(pg, 'site')
        pg.select_option('#siteSel', index=0); pg.wait_for_timeout(600)
        pg.evaluate('window.LWB_LP_MS = 0'); pg.click('#tolBtn')
        pg.wait_for_function('window.LWB_LP_MS > 0', timeout=120000); pg.wait_for_timeout(800)
        print('landing precision, no ellipse:', txt(pg, '#lpTitle'), '|', txt(pg, '#lpOut'))
        pg.fill('#lpA', '300'); pg.fill('#lpB', '200'); pg.dispatch_event('#lpB', 'change'); pg.wait_for_timeout(700)
        print('landing precision, 300 x 200 m:', txt(pg, '#lpOut'))
        print('lp note:', txt(pg, '#lpNote')[:200])
        pg.locator('#lpCard').screenshot(path=out + '/d14_landing_precision.png')
        pg.select_option('#lpShow', 'pass'); pg.wait_for_timeout(300); pg.locator('#lpMap').screenshot(path=out + '/d14c_lp_pass.png')
        print('hash:', pg.evaluate('location.hash'))
        pg.click('#themeBtn'); pg.wait_for_timeout(600); pg.screenshot(path=out + '/d16_find_dark.png', full_page=True); pg.click('#themeBtn')

        # ---------- other entry points ----------
        pg2 = page_for(1360, 900, frag='#s=a11&t=1969-07-20T20:18Z')
        print('apollo epoch:', txt(pg2, '#heroNow')[:160], '| badge:', txt(pg2, '#vFallback')[:90])
        pg3 = page_for(1360, 900, frag='#s=shackleton&t=2027-03-05T12:00Z&v=list')
        assert pg3.locator('#view-list').is_visible() and pg3.locator('#listTable tr[data-i]').count() > 10
        print('link opens the list view directly')
        m = page_for(390, 844, mobile=True, frag='#s=ridge&t=2027-03-05T12:00Z')
        m.screenshot(path=out + '/m1_site.png')
        mh = m.locator('.hero').bounding_box()['height']; print('mobile hero height:', mh); assert mh < 844 - 52 - 60, 'on a phone the page below the sky must be reachable'
        assert m.evaluate('getComputedStyle(document.getElementById("sky")).touchAction') == 'pan-y', 'vertical swipes on the sky must scroll the page'
        m.screenshot(path=out + '/m1_site_full.png', full_page=True)
        sw = m.evaluate('document.documentElement.scrollWidth'); print('mobile scrollWidth, site:', sw); assert sw <= 392
        m.click('#modePolar'); m.wait_for_timeout(500); m.screenshot(path=out + '/m2_polar.png'); m.click('#modeSky')
        view(m, 'list'); m.wait_for_timeout(1500); m.screenshot(path=out + '/m3_list.png')
        sw = m.evaluate('document.documentElement.scrollWidth'); print('mobile scrollWidth, list:', sw); assert sw <= 392
        view(m, 'find'); m.wait_for_function('window.LWB_FIND_MS > 0', timeout=180000); m.wait_for_timeout(500); m.screenshot(path=out + '/m4_find.png', full_page=True)
        sw = m.evaluate('document.documentElement.scrollWidth'); print('mobile scrollWidth, find:', sw, m.evaluate('''[...document.querySelectorAll("#view-find *")].filter(e=>e.getBoundingClientRect().right>392&&!e.closest(".tblwrap")).slice(0,6).map(e=>e.tagName+"#"+e.id+"."+e.className)''')); assert sw <= 392
        if helper:
            hp = page_for(1360, 900, url='http://127.0.0.1:8791/', frag='#s=ridge&t=2027-03-05T12:00Z')
            print('served by helper:', hp.evaluate('document.getElementById("helperNote").textContent')[:60], '|', txt(hp, '#vSite'))
            view(hp, 'list'); hp.click('#addBtn'); hp.wait_for_timeout(1500)
            hp.fill('#newName', 'Away from any listed site'); hp.fill('#newLat', '-87.2'); hp.fill('#newLon', '70'); hp.click('#addOk'); hp.wait_for_timeout(5000)
            view(hp, 'site')
            print('custom via helper:', txt(hp, '#vSite'), '|', txt(hp, '#vState'), '|', txt(hp, '#vAssume')[:150])
            hp.click('#removeSite')
        b.close()
finally:
    if helper:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(helper.pid)], capture_output=True) if os.name == 'nt' else helper.terminate()
print('ERRORS:', '\n'.join(errs) if errs else 'none')
sys.exit(1 if errs else 0)
