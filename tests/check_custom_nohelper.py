"""Custom sites without the terrain helper: a point within 1 km of a listed south-pole site takes the nearest
100 m grid mask; a polar point elsewhere gets the no-terrain stop.  Usage: python tests/check_custom_nohelper.py
(run npm run build first: it loads dist/lunar-window-browser.html)"""
import sys, pathlib
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
AE = str(ROOT / 'node_modules' / 'astronomy-engine' / 'astronomy.browser.min.js')
ok = True
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1360, 'height': 1000})
    pg.add_init_script("try { localStorage.setItem('lwb.tour.v1', 'done'); } catch (e) {}")  # skip the first-visit tour prompt
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/astronomy.browser.min.js', lambda r: r.fulfill(path=AE, content_type='application/javascript'))
    pg.route('**/fonts.g*/**', lambda r: r.abort())
    pg.route('http://127.0.0.1:8791/**', lambda r: r.abort())       # no helper
    pg.goto((ROOT / 'dist' / 'lunar-window-browser.html').as_uri() + '#s=ridge&t=2027-03-05T12:00Z&v=list')
    pg.wait_for_function('window.LWB_READY_MS > 0')
    def add(name, lat, lon):
        pg.click('.views [data-view="list"]'); pg.wait_for_timeout(300)
        if not pg.locator('#addForm').is_visible():
            pg.click('#addBtn')
        pg.wait_for_timeout(2200)
        pg.fill('#newName', name); pg.fill('#newLat', str(lat)); pg.fill('#newLon', str(lon)); pg.click('#addOk'); pg.wait_for_timeout(2500)
        pg.click('.views [data-view="site"]'); pg.wait_for_timeout(600)
        return pg.inner_text('#vState'), pg.inner_text('#vAssume')[:150], (pg.inner_text('#vBadge')[:60] if pg.locator('#vBadge').is_visible() else '')
    st, a, bd = add('Near the ridge', -89.4540, 222.90)
    print('near a listed site :', st, '|', a); ok &= 'nearest 100 m grid point' in a
    pg.click('#removeSite'); pg.wait_for_timeout(400)
    st, a, bd = add('Elsewhere', -87.2, 70.0)
    print('polar, no terrain  :', st, '|', bd); ok &= st.upper() == 'NO TERRAIN' and bd.startswith('No terrain for this point')
    pg.click('#removeSite')
    b.close()
print('page errors:', errs or 'none'); print('PASS' if ok and not errs else 'FAIL')
sys.exit(0 if ok and not errs else 1)
