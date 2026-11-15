"""Playwright smoke test: load the built page exactly as shipped (dist/lunar-window-browser.html, no wrapper),
walk through the four views (Site, Compare, Finder, Method), screenshot, print the key numbers and report console errors.
Exits non-zero on any console error, page error or failed assertion.  Usage: python tests/screenshot.py [outdir] [--no-helper]

If data/raw is present the terrain helper (tools/terrain/serve.py) is started on port 8791 and the custom-site flow is
tested against it; otherwise that part is skipped and the script says so.
If the page carries a catalogue of real lunar orbiters (#satList has built-in rows at load) the checks that depend on
it run after the background propagation has finished; otherwise they are skipped and the script says so."""
import sys, os, re, pathlib, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
S = str(ROOT / 'tests' / 'out')
AE = str(ROOT / 'node_modules' / 'astronomy-engine' / 'astronomy.browser.min.js')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = args[0] if args else S
os.makedirs(out, exist_ok=True)
URL = (ROOT / 'dist' / 'lunar-window-browser.html').as_uri()
errs = []
fails = []   # failed phone-layout assertions: recorded so the rest of the run still happens, and they fail the exit code
def soft(ok, msg):
    if not ok:
        fails.append(msg); print('ASSERTION FAILED (recorded):', msg)
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
    print('helper: not started, custom-terrain tests skipped')

TEST_STATE = (('satX', '0'), ('satY', '0'), ('satZ', '2237.4'), ('satVX', '1.8878'), ('satVY', '0'), ('satVZ', '0'))
PROP_WAIT = 180000

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        def page_for(w, h, mobile=False, frag='', url=URL, wait='window.LWB_READY_MS > 0'):
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1 if not mobile else 2, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
            pg = ctx.new_page()
            # a refused helper probe is expected when the helper is not running (the add-site form pings it)
            # 'GPU stall due to ReadPixels': headless Chrome's software WebGL when the harness screenshots the 3D canvas
            quiet = ('GPU stall due to ReadPixels',) + (() if helper else ('ERR_CONNECTION_REFUSED',))
            pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and not any(q in m.text for q in quiet) else None)
            pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            pg.route('**/astronomy.browser.min.js', lambda r: r.fulfill(path=AE, content_type='application/javascript'))
            pg.goto(url + frag)
            pg.wait_for_function(wait, timeout=120000)
            print('(%dx%d) script boot %d ms, all sites ready %d ms' % (w, h, pg.evaluate('window.LWB_BOOT_MS'), pg.evaluate('window.LWB_READY_MS')))
            pg.wait_for_timeout(1500)
            return pg
        def txt(pg, sel): return pg.inner_text(sel).replace('\n', ' | ').replace('\t', ' ')
        def view(pg, v): pg.click('.views [data-view="%s"]' % v); pg.wait_for_timeout(700)
        def settle(pg, ms=800):
            pg.wait_for_function('document.getElementById("busy").hidden', timeout=60000); pg.wait_for_timeout(ms)
        def stat(pg, label):
            """Text of the value cell in #vStats whose row heading starts with label."""
            return pg.evaluate('''l => { const r = [...document.querySelectorAll("#vStats tr")].find(x => x.querySelector("th") && x.querySelector("th").textContent.indexOf(l) === 0); return r ? r.querySelector("td").textContent : null; }''', label)
        def link_row(pg):
            """(label, percentage) of the link row of #vStats."""
            r = pg.evaluate('''() => { const r = [...document.querySelectorAll("#vStats tr")].find(x => /^(Earth link|Link \\(direct or relay\\))/.test(x.querySelector("th").textContent)); return r ? [r.querySelector("th").textContent, r.querySelector("td").textContent] : null; }''')
            assert r, 'no link row in #vStats'
            return r[0], int(re.sub(r'[^\d]', '', r[1].split('%')[0]))
        def row_of(pg, name): return pg.locator('#satList .comrow', has_text=name)
        def wait_prop(pg, what):
            pg.wait_for_function('window.LWB_PROP_IDLE === true', timeout=PROP_WAIT); pg.wait_for_timeout(500)
            print('propagation idle (%s); status bar: %r' % (what, pg.inner_text('#sbProp')))
        def no_sideways(pg, label, limit=None):
            sw = pg.evaluate('document.documentElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
            print('scrollWidth, %s: %d of %d' % (label, sw, iw))
            assert sw <= (limit or iw), 'the page scrolls sideways (%s): %d > %d' % (label, sw, limit or iw)
        def statusbar(pg): return ' || '.join(txt(pg, i) for i in ('#sbEph', '#sbTerr', '#sbSat', '#sbProp'))

        # ---------- view 1: one site ----------
        pg = page_for(1440, 900, frag='#s=ridge&t=2027-03-05T12:00Z')
        body = pg.inner_text('body')
        assert 'Â' not in body and '�' not in body, 'mis-decoded characters on the page'
        has_cat = pg.locator('#satList [data-sat]').count() > 0
        print('catalogue of real orbiters in the page:', ('yes, %d rows' % pg.locator('#satList [data-sat]').count()) if has_cat else 'absent: catalogue-dependent checks skipped')
        if has_cat:
            wait_prop(pg, 'after load')
        pg.screenshot(path=out + '/d1_site.png')
        pg.screenshot(path=out + '/d1_site_full.png', full_page=True)
        print('state:', txt(pg, '#vState'))
        print('reason:', txt(pg, '#vReason'))
        print('now:', txt(pg, '#vNow'))
        print('stats heading:', txt(pg, '#vStatsH'), '| stats:', txt(pg, '#vStats'))
        print('windows:', txt(pg, '#vWins'))
        print('hud:', txt(pg, '#hud'))
        print('status bar:', statusbar(pg))
        no_sideways(pg, 'site 1440')
        hero = pg.locator('.hero').bounding_box(); tl = pg.locator('#play').bounding_box(); st = pg.locator('#strip').bounding_box()
        print('hero: %d x %d at y=%d | timeline controls y=%d..%d | strip y=%d h=%d (screen 900)' % (hero['width'], hero['height'], hero['y'], tl['y'], tl['y'] + tl['height'], st['y'], st['height']))
        assert hero['y'] >= 0 and hero['y'] + hero['height'] <= 900, 'the viewport (.hero) must be fully visible without scrolling at 1440 x 900'
        assert tl['y'] >= 0 and tl['y'] + tl['height'] <= 900, 'the top of the timeline must be visible without scrolling at 1440 x 900'
        assert pg.locator('.views [data-view]').count() == 4
        assert pg.locator('#siteSel option[value="add"]').count() == 1
        sr0 = txt(pg, '#vState')
        assert sr0 in ('Constraints met', 'Constraints not met'), 'unexpected state badge: ' + sr0
        t_label0 = ' '.join(pg.inner_text('#tLabel').split())
        assert '2027 Mar 5 12:00' in t_label0, 'the link time was not applied: ' + t_label0

        # ---------- the analysis tabs ----------
        def atab(k):
            pg.click('#atabs [data-atab="%s"]' % k); pg.wait_for_timeout(500)
            assert pg.get_attribute('#atabs [data-atab="%s"]' % k, 'aria-selected') == 'true'
            vis = pg.evaluate('[...document.querySelectorAll(".lower > [data-atab]")].filter(d => !d.hidden).map(d => d.getAttribute("data-atab"))')
            assert vis == [k], 'only the selected analysis tab may be visible, got %s' % vis
        atab('skyline'); pg.wait_for_timeout(500)
        print('skyline read:', txt(pg, '#hzRead')[:240], '| note:', txt(pg, '#hzNote')[:160])
        pg.locator('.lower').screenshot(path=out + '/d2_skyline.png')

        atab('slip')
        pg.wait_for_function('document.getElementById("slipRead").textContent.indexOf("Landing between") === 0', timeout=60000)
        slip0 = pg.locator('#slipTable tr[data-t]').nth(0).inner_text().replace('\n', ' ').replace('\t', ' | ')
        print('slip rows:', pg.locator('#slipTable tr[data-t]').count(), '| dial time:', slip0, '| +7 d:', pg.locator('#slipTable tr[data-t]').nth(5).inner_text().replace('\n', ' ').replace('\t', ' | '))
        tile_irr = int(re.sub(r'[^\d]', '', stat(pg, 'Mean irradiance').split('W')[0]))
        slip_irr = int(re.sub(r'[^\d]', '', slip0.split('|')[1].split('W')[0]))
        print('slip check: statistics mean %d W/m2 (10-min steps) vs slip table %d W/m2 (hourly), difference %d' % (tile_irr, slip_irr, abs(tile_irr - slip_irr)))
        assert abs(tile_irr - slip_irr) <= 10, 'the slip table disagrees with the mean irradiance in the statistics'
        print('slip chart:', txt(pg, '#slipRead'))
        pg.locator('.lower').screenshot(path=out + '/d2_slip.png')
        pg.click('#slipTable tr[data-t] >> nth=5'); pg.wait_for_timeout(1000)
        assert '2027 Mar 12' in txt(pg, '#tLabel'), 'a slip row should move the time: ' + txt(pg, '#tLabel')
        pg.fill('#tTime', '2027-03-05T12:00'); pg.dispatch_event('#tTime', 'change'); pg.wait_for_timeout(1000)
        assert '2027 Mar 5 12:00' in ' '.join(pg.inner_text('#tLabel').split()), 'the time box should move the time: ' + pg.inner_text('#tLabel')

        atab('maps'); pg.wait_for_timeout(1000)
        pg.locator('.lower').screenshot(path=out + '/d2_maps.png')

        atab('unc')
        pg.wait_for_function('document.getElementById("uTable").textContent.indexOf("Across 16 clones") >= 0', timeout=60000)
        tc = lambda sel: pg.evaluate('s => document.querySelector(s).textContent', sel)
        assert 'Skyline scatter across 16' in tc('#vTerrUnc'), 'terrain uncertainty not stated: ' + tc('#vTerrUnc')
        assert 'Ground height' in txt(pg, '#uCards') and 'Skyline edge' in txt(pg, '#uCards'), 'plain-language uncertainty cards missing: ' + txt(pg, '#uCards')
        print('uncertainty cards:', txt(pg, '#uCards').replace(chr(10), ' | '))
        print('uncertainty table:', tc('#uTable'))
        pg.locator('.lower').screenshot(path=out + '/d2_unc.png')

        atab('model')
        print('model:', txt(pg, '#vWhy'))
        assert 'LOLA' in txt(pg, '#vWhy')
        pg.locator('.lower').screenshot(path=out + '/d2_model.png')
        atab('skyline')

        # ---------- viewport tabs ----------
        pg.evaluate('window.scrollTo(0,0)')
        def vtab(i): return pg.get_attribute('#' + i, 'aria-selected')
        pg.click('#modePolar'); pg.wait_for_timeout(700)
        assert vtab('modePolar') == 'true' and vtab('modeSky') == 'false'
        pg.screenshot(path=out + '/d3_skyplot.png')
        print('sky plot:', txt(pg, '#polarRead'), '| hash', pg.evaluate('location.hash'))
        pg.click('#mode3d'); pg.wait_for_function('document.getElementById("t3Read").textContent.indexOf("LOLA") === 0', timeout=60000); pg.wait_for_timeout(800)
        assert vtab('mode3d') == 'true'
        pg.screenshot(path=out + '/d3_terrain3d.png')
        print('3d:', txt(pg, '#t3Read'), '| hash', pg.evaluate('location.hash'))
        chk = pg.evaluate('window.LWB_T3CHECK()'); print('3d centre node vs page skyline:', chk)
        assert chk and chk['agree'] >= 0.9 * chk['samples'], '3D shading disagrees with the page skyline at the site'
        pg.click('#t3Surf [data-surf="img"]'); pg.wait_for_timeout(1500); pg.screenshot(path=out + '/d3_terrain3d_image.png')
        print('3d, LROC surface:', txt(pg, '#t3Read'))
        pg.click('#t3Surf [data-surf="sun"]'); pg.wait_for_timeout(400)
        pg.click('#modeSky'); pg.wait_for_timeout(600)
        assert vtab('modeSky') == 'true'
        for look in ('sun', 'earth'):
            pg.click('[data-look="%s"]' % look); pg.wait_for_timeout(1000); pg.screenshot(path=out + '/d3_look_%s.png' % look)
        # display-only toggle
        before = txt(pg, '#vNow') + txt(pg, '#vStats')
        assert pg.get_attribute('#optGrid', 'aria-pressed') == 'false'
        pg.click('#optGrid'); pg.wait_for_timeout(800)
        assert pg.get_attribute('#optGrid', 'aria-pressed') == 'true'
        pg.screenshot(path=out + '/d3_grid.png')
        assert txt(pg, '#vNow') + txt(pg, '#vStats') == before, 'the grid toggle changed a number'
        pg.click('#optGrid'); pg.wait_for_timeout(300)
        print('display-only grid toggle leaves every number unchanged')

        # ---------- constraints and ground stations ----------
        base_reason = txt(pg, '#vReason'); base_stats = txt(pg, '#vStats')
        pg.select_option('#sunFrac', '0.5'); pg.fill('#linkMin', '2'); pg.dispatch_event('#linkMin', 'change'); settle(pg, 1000)
        print('with half-disk Sun and 2 deg margin:', txt(pg, '#vState'), '-', txt(pg, '#vReason'))
        print('  stats:', txt(pg, '#vStats'))
        assert '2' in txt(pg, '#pLim') and pg.input_value('#sunFrac') == '0.5'
        if not pg.evaluate('document.getElementById("pGs").open'): pg.click('#pGs summary')
        pg.check('#ground'); settle(pg, 2500)
        print('with DSN:', txt(pg, '#vReason'), '|', txt(pg, '#vStats'))
        pg.uncheck('#ground'); settle(pg, 1500)
        pg.select_option('#sunFrac', '0'); pg.fill('#linkMin', '0'); pg.dispatch_event('#linkMin', 'change'); settle(pg, 1500)
        assert txt(pg, '#vReason') == base_reason and txt(pg, '#vStats') == base_stats, 'restoring the constraints did not restore the numbers'
        print('constraints restored: numbers identical to the start')

        # ---------- relay satellite: user-entered two-body orbit, apoapsis over the south pole ----------
        if not pg.evaluate('document.getElementById("pSat").open'): pg.click('#pSat summary')
        lbl0, pct0 = link_row(pg)
        strip0 = pg.locator('#strip').bounding_box()['height']
        nsat0 = pg.locator('#satList .comrow').count()
        print('before relay: "%s" %d%% | strip height %d | satellites listed %d' % (lbl0, pct0, strip0, nsat0))
        assert lbl0 == 'Earth link', 'with no relay the link row should read "Earth link", got ' + lbl0
        pg.click('#satAdd summary'); pg.fill('#satName', 'Test relay')
        pg.select_option('#satKind', 'kep')
        for k, v in TEST_STATE: pg.fill('#' + k, v)
        pg.select_option('#satFrame', 'moon')
        print('epoch field default:', pg.input_value('#satEpoch'))
        assert pg.input_value('#satEpoch'), 'the epoch should default to the current time'
        pg.click('#satForm button[type=submit]'); settle(pg, 2500)
        print('add message:', pg.text_content('#satMsg'))
        lbl1, pct1 = link_row(pg)
        strip1 = pg.locator('#strip').bounding_box()['height']
        print('relay: "%s" %d%% (was %d%%) | strip height %d (was %d)' % (lbl1, pct1, pct0, strip1, strip0))
        print('satList:', txt(pg, '#satList')[:400])
        print('hud:', txt(pg, '#hud'))
        print('now (satellite rows):', txt(pg, '#vNow'))
        assert row_of(pg, 'Test relay').count() == 1 and row_of(pg, 'Test relay').locator('[data-relay]').is_checked(), 'the new satellite should be listed and ticked as a relay'
        assert lbl1 == 'Link (direct or relay)', 'the statistics should name the relay link, got ' + lbl1
        assert pct1 >= pct0, 'a relay can only add link time'
        assert strip1 > strip0, 'the timeline should get one more row'
        assert 'Test relay' in txt(pg, '#hud'), 'the readout should name the satellite'
        assert 'Test relay' in txt(pg, '#vNow')
        pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(300)
        pg.screenshot(path=out + '/d4_relay.png')
        row_of(pg, 'Test relay').locator('[data-relay]').uncheck(); settle(pg, 2000)
        lbl2, pct2 = link_row(pg)
        print('relay unticked: "%s" %d%%' % (lbl2, pct2))
        assert pct2 == pct0 and lbl2 == 'Earth link', 'unticking the relay should restore the Earth-link percentage'
        row_of(pg, 'Test relay').locator('[data-delsat]').click(); settle(pg, 1500)
        assert 'Test relay' not in txt(pg, '#satList'), 'the removed satellite is still listed'
        assert pg.locator('#satList .comrow').count() == nsat0
        assert link_row(pg) == (lbl0, pct0)
        print('relay removed: list back to %d rows, link %d%%' % (nsat0, pct0))

        # ---------- catalogue and the full-force-model satellite ----------
        if has_cat:
            wait_prop(pg, 'before the catalogue screenshot')
            print('satList:', txt(pg, '#satList')[:900])
            print('catalogue rows of #vNow:', txt(pg, '#vNow')[:1200])
            print('status bar:', statusbar(pg))
            assert 'Propagating' not in txt(pg, '#satList'), 'a satellite row still says Propagating when the propagation is idle'
            pg.screenshot(path=out + '/d5_catalogue.png')
            n_err = len(errs)
            pg.click('#play'); pg.wait_for_timeout(1000); pg.click('#play'); pg.wait_for_timeout(800)
            assert len(errs) == n_err, 'errors while playing with the catalogue: %s' % errs[n_err:]
            print('played a second with the catalogue; time now', txt(pg, '#tLabel'))
            pg.fill('#tTime', '2027-03-05T12:00'); pg.dispatch_event('#tTime', 'change'); pg.wait_for_timeout(1500)
        nsat0 = pg.locator('#satList .comrow').count()
        pg.click('#satAdd summary'); pg.fill('#satName', 'Test numeric')
        pg.select_option('#satKind', 'num')
        for k, v in TEST_STATE: pg.fill('#' + k, v)
        pg.select_option('#satFrame', 'moon')
        pg.click('#satForm button[type=submit]'); pg.wait_for_timeout(300)
        print('numeric satellite added:', pg.text_content('#satMsg'), '| row:', row_of(pg, 'Test numeric').inner_text().replace('\n', ' | ')[:300])
        if 'Propagator not loaded' in txt(pg, '#satList'):
            print('NOTE: the page has no propagator; the numeric satellite fell back to two-body')
        else:
            wait_prop(pg, 'numeric user satellite')
        settle(pg, 1500)
        row = row_of(pg, 'Test numeric').inner_text().replace('\n', ' | ')
        print('numeric satellite row:', row)
        assert 'Propagating' not in row, 'the numeric satellite still says Propagating after the propagation finished'
        assert 'Test numeric' in txt(pg, '#vNow'), 'the numeric satellite should have a row in the status table'
        print('now (satellite rows):', txt(pg, '#vNow')[-500:])
        row_of(pg, 'Test numeric').locator('[data-delsat]').click(); settle(pg, 1500)
        assert 'Test numeric' not in txt(pg, '#satList') and pg.locator('#satList .comrow').count() == nsat0

        # ---------- another kind of site, playback, export ----------
        opt = pg.evaluate('(() => { const o = [...document.querySelectorAll("#siteSel option")].find(x => x.textContent.indexOf("Apollo 11") >= 0); return o ? o.value : null; })()')
        assert opt is not None, 'no Apollo 11 site in the site list'
        pg.select_option('#siteSel', opt); settle(pg, 1200)
        print('apollo 11:', txt(pg, '#vState'), '|', txt(pg, '#vReason'), '|', txt(pg, '#vCoord'))
        print('apollo 11 stats:', txt(pg, '#vStats'))
        pg.click('#play'); pg.wait_for_timeout(1200); pg.click('#play')
        pg.click('#modePolar'); pg.wait_for_timeout(700); pg.screenshot(path=out + '/d6_apollo_skyplot.png')
        print('apollo sky plot:', txt(pg, '#polarRead'))
        pg.click('#modeSky')
        with pg.expect_download() as dl:
            pg.click('#csvBtn')
        head = pg.evaluate('window.LWB_LAST_EXPORT')
        assert head and 'irradiance_w_m2' in head, 'the export text is missing or has no irradiance column'
        lines = head.splitlines()
        print('csv:', dl.value.suggested_filename, '|', len(lines), 'lines |', lines[-2], '|', lines[-1])

        # ---------- view: compare ----------
        pg.select_option('#siteSel', index=0); settle(pg, 600)
        view(pg, 'list'); pg.wait_for_timeout(2500)
        assert pg.locator('#view-list').is_visible() and pg.get_attribute('.views [data-view="list"]', 'aria-selected') == 'true'
        pg.screenshot(path=out + '/d7_compare.png', full_page=True)
        rows = pg.locator('#listTable tr[data-i]').count()
        print('list rows:', rows, '|', txt(pg, '#listWhen'))
        assert rows > 10
        print('list first rows:', ' // '.join(pg.locator('#listTable tr[data-i]').nth(i).inner_text().replace('\n', ' ').replace('\t', ' | ') for i in range(3)))
        pg.click('#listTable th[data-k="irr"]'); pg.wait_for_timeout(300)
        assert pg.get_attribute('#listTable th[data-k="irr"]', 'aria-sort') == 'descending'
        print('sorted by mean irradiance, top:', pg.locator('#listTable tr[data-i]').nth(0).inner_text().replace('\n', ' ').replace('\t', ' | ')[:160])
        pg.click('#listTable th[data-k="irr"]'); pg.click('#listTable th[data-k="irr"]'); pg.wait_for_timeout(200)
        pg.click('#addBtn'); pg.wait_for_timeout(1800)
        assert pg.locator('#addForm').is_visible()
        pg.fill('#bulk', 'Mid A, -30, 100\nNear the ridge, -89.4540, 222.90\nbad line\nAway from any site; -87.2; 70.0'); pg.click('#bulkOk')
        pg.wait_for_function('document.getElementById("addHint").textContent.indexOf("Added") >= 0', timeout=60000); pg.wait_for_timeout(1500)
        print('bulk add:', txt(pg, '#addHint')[:140], '| rows now', pg.locator('#listTable tr[data-i]').count())
        assert pg.locator('#listTable tr[data-i]').count() == rows + 3
        pg.screenshot(path=out + '/d7_compare_custom.png', full_page=True)
        with pg.expect_download() as dl:
            pg.click('#listCsv')
        print('list csv:', dl.value.suggested_filename)
        for _ in range(3):
            pg.click('#listTable button[data-act="del"] >> nth=0'); pg.wait_for_timeout(600)
        assert pg.locator('#listTable tr[data-i]').count() == rows, 'deleting the three added sites should restore the row count'
        # a click on a row opens the Site view on that site
        pg.click('#listTable tr[data-i] >> nth=2'); pg.wait_for_timeout(1000)
        i = pg.evaluate('document.getElementById("siteSel").value')
        assert pg.locator('#view-site').is_visible() and pg.get_attribute('.views [data-view="site"]', 'aria-selected') == 'true', 'a click on a row should open the Site view'
        print('row click -> Site view on:', txt(pg, '#vCoord'), '| siteSel', pg.evaluate('document.getElementById("siteSel").selectedOptions[0].textContent'))

        # ---------- view: find a site ----------
        view(pg, 'find')
        pg.fill('#fStart', '2027-03-05'); pg.dispatch_event('#fStart', 'change')
        pg.wait_for_function('window.LWB_FIND_MS > 0 && document.querySelectorAll("#funnel li").length > 0', timeout=180000); pg.wait_for_timeout(800)
        print('survey evaluated; funnel:', txt(pg, '#funnel'))
        print('survey note:', txt(pg, '#fSurveyNote'), '| constraints in use:', txt(pg, '#fLim'))
        pg.screenshot(path=out + '/d8_find.png', full_page=True)
        # ranges (2026-11-15 finder): parts of the scores open under "Set the parts"
        pg.click('.cons[data-k="sol"] details > summary'); pg.click('.cons[data-k="ear"] details > summary')
        for k, end, v in [('irr', 'lo', '700'), ('dark', 'hi', '150'), ('earth', 'lo', '40'), ('slope', 'hi', '10')]:
            sel = '.cons[data-k="%s"] > .dual .%s' % (k, end)
            pg.fill(sel, v); pg.dispatch_event(sel, 'change')
        assert pg.evaluate("document.querySelector('.cons[data-k=sol]').classList.contains('frozen')"), 'setting a solar part should freeze the solar score'
        pg.wait_for_timeout(1000)
        print('funnel with goals:', txt(pg, '#funnel'))
        ncand = pg.locator('#fTable tr[data-k]').count()
        print('top candidates:', ' // '.join(pg.locator('#fTable tr[data-k]').nth(i).inner_text().replace('\t', ' | ') for i in range(min(3, ncand))))
        pg.screenshot(path=out + '/d8_find_goals.png', full_page=True)
        f_all = txt(pg, '#funnel')
        pg.fill('#fLat0', '89'); pg.dispatch_event('#fLat0', 'change'); pg.wait_for_timeout(600)
        f_area = txt(pg, '#funnel')
        print('funnel, south of 89S:', f_area[:220])
        assert f_area != f_all, 'restricting the area did not change the funnel'
        pg.fill('#fLat0', ''); pg.dispatch_event('#fLat0', 'change'); pg.wait_for_timeout(600)
        assert txt(pg, '#funnel') == f_all, 'clearing the area did not restore the funnel'
        assert ncand > 0, 'no candidate meets the goals (mean >= 700, dark <= 150 h, Earth >= 40 %, slope <= 10 deg), so the open-candidate flow cannot be tested'
        assert pg.is_disabled('#fOpen'), '#fOpen should be disabled until a candidate is selected'
        first = pg.locator('#fTable tr[data-k] >> nth=0').inner_text().split('\t')[0]
        pg.click('#fTable tr[data-k] >> nth=0'); pg.wait_for_timeout(1000)
        print('candidate chosen:', txt(pg, '#fSel')[:300])
        assert not pg.is_disabled('#fOpen'), '#fOpen should be enabled once a candidate is selected'
        pg.click('#fOpen'); pg.wait_for_timeout(2500)
        assert pg.locator('#view-site').is_visible()
        opened = pg.evaluate('document.getElementById("siteSel").selectedOptions[0].textContent')
        print('candidate opened in the Site view:', opened, '|', txt(pg, '#vCoord'), '|', txt(pg, '#vState'), '|', txt(pg, '#sbTerr'))
        assert opened.startswith('Survey point') and first.split('°')[0][:4] in opened, 'the Site view is not showing the chosen candidate: %s vs %s' % (opened, first)
        assert 'LOLA' in txt(pg, '#sbTerr'), 'the opened candidate has no LOLA terrain label'
        assert pg.is_visible('#removeSite')
        pg.screenshot(path=out + '/d8_candidate_site.png')
        pg.click('#removeSite'); pg.wait_for_timeout(800)
        assert not pg.is_visible('#removeSite')

        # ---------- method ----------
        view(pg, 'method')
        assert pg.locator('#view-method').is_visible()
        pg.screenshot(path=out + '/d9_method.png', full_page=True)
        print('method:', txt(pg, '#mH'), '| headings:', pg.evaluate('[...document.querySelectorAll("#view-method h3")].map(h => h.textContent).join("; ")'))
        view(pg, 'site')

        # ---------- other entry points ----------
        pg2 = page_for(1360, 900, frag='#s=a11&t=1969-07-20T20:18Z')
        print('apollo epoch now:', txt(pg2, '#vNow')[:300])
        print('apollo epoch fallback notice (hidden=%s):' % pg2.evaluate('document.getElementById("vFallback").hidden'), txt(pg2, '#vFallback')[:200])
        print('apollo epoch badge:', txt(pg2, '#vState'), '|', txt(pg2, '#vReason'))
        pg3 = page_for(1360, 900, frag='#s=shackleton&t=2027-03-05T12:00Z&v=list')
        assert pg3.locator('#view-list').is_visible() and pg3.locator('#listTable tr[data-i]').count() > 10
        assert pg3.get_attribute('.views [data-view="list"]', 'aria-selected') == 'true'
        print('link opens the Compare view directly')

        # ---------- phone ----------
        m = page_for(390, 844, mobile=True, frag='#s=ridge&t=2027-03-05T12:00Z')
        m.screenshot(path=out + '/m1_site.png')
        mh = m.locator('.hero').bounding_box(); print('mobile hero: y=%d height=%d bottom=%d of 844' % (mh['y'], mh['height'], mh['y'] + mh['height']))
        soft(mh['y'] + mh['height'] <= 844 - 60, 'phone, Site view: the sky (.hero) bottom edge is at %d, below 844 - 60 = 784, so the page below it is not in the first screen' % (mh['y'] + mh['height']))
        assert m.evaluate('getComputedStyle(document.getElementById("sky")).touchAction') == 'pan-y', 'vertical swipes on the sky must scroll the page'
        m.screenshot(path=out + '/m1_site_full.png', full_page=True)
        no_sideways(m, 'phone, site', 392)
        m.click('#modePolar'); m.wait_for_timeout(700); m.screenshot(path=out + '/m2_skyplot.png')
        ph = m.locator('.hero').bounding_box(); soft(ph['y'] + ph['height'] <= 844 - 60, 'phone, sky plot: the viewport bottom edge is at %d, below 784' % (ph['y'] + ph['height']))
        no_sideways(m, 'phone, sky plot', 392)
        m.click('#modeSky')
        view(m, 'list'); m.wait_for_timeout(1500); m.screenshot(path=out + '/m3_compare.png')
        no_sideways(m, 'phone, compare', 392)
        view(m, 'find'); m.wait_for_function('window.LWB_FIND_MS > 0', timeout=180000); m.wait_for_timeout(800); m.screenshot(path=out + '/m4_find.png', full_page=True)
        print('phone finder: elements wider than the screen:', m.evaluate('''[...document.querySelectorAll("#view-find *")].filter(e=>e.getBoundingClientRect().right>392&&!e.closest(".tblwrap")).slice(0,6).map(e=>e.tagName+"#"+e.id+"."+e.className)'''))
        no_sideways(m, 'phone, finder', 392)
        view(m, 'method'); no_sideways(m, 'phone, method', 392)

        # ---------- terrain helper ----------
        if helper:
            hp = page_for(1360, 900, url='http://127.0.0.1:8791/', frag='#s=ridge&t=2027-03-05T12:00Z')
            print('served by helper: Site view', txt(hp, '#vCoord'))
            view(hp, 'list'); hp.click('#addBtn'); hp.wait_for_timeout(1500)
            print('helper hint:', txt(hp, '#addHint')[:160])
            hp.fill('#newName', 'Away from any listed site'); hp.fill('#newLat', '-87.2'); hp.fill('#newLon', '70'); hp.click('#addOk')
            hp.wait_for_function('document.getElementById("addHint").textContent.indexOf("Added") >= 0', timeout=120000); hp.wait_for_timeout(1500)
            view(hp, 'site'); hp.wait_for_timeout(1500)
            terr = txt(hp, '#sbTerr')
            hp.click('#atabs [data-atab="model"]'); hp.wait_for_timeout(500)
            print('custom via helper:', txt(hp, '#vCoord'), '|', txt(hp, '#vState'), '|', terr, '|', txt(hp, '#vWhy')[:300])
            assert 'LOLA' in terr and 'on demand' in txt(hp, '#vWhy').lower() + ' ' + terr.lower() or 'LOLA' in terr, 'the helper should give the custom site LOLA terrain'
            hp.click('#removeSite')
        b.close()
finally:
    if helper:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(helper.pid)], capture_output=True) if os.name == 'nt' else helper.terminate()
print('ERRORS:', '\n'.join(errs) if errs else 'none')
print('RECORDED FAILURES:', '\n'.join(fails) if fails else 'none')
sys.exit(1 if errs or fails else 0)
