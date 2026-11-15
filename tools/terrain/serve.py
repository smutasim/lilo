"""Terrain helper: full-resolution LOLA horizon masks for any point south of 80 S, computed on demand.

The page ships masks for its listed sites only. A custom coordinate near the pole needs its own mask, and the
raw DEMs (about 7 GB) cannot go into a web page. This small local server runs the same code that built
data/terrain.json (lolaterrain.horizon_mask) for whatever point the page asks for, in about a second.

  python tools/terrain/serve.py            # then open http://127.0.0.1:8791/
  GET /            the built page (dist/lunar-window-browser.html), so the page and helper share an origin
  GET /ping        {"ok": true, ...}
  GET /mask?lat=-88.5&lon=45     a record shaped like one entry of data/terrain.json "sites"
  GET /grid?lat=..&lon=..&n=21&d=50&row=0   one row of a landing-precision grid (n x n masks at d metres)
  GET /regions/<id>.js           the prebuilt 50 m grids, if dist/regions exists

The page also finds the helper when opened from a file or another host (CORS is open; the server binds to
127.0.0.1 only). Needs data/raw as listed in the README; the first start builds the 3.7 GB float cache.
"""
import argparse, glob, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt  # noqa: E402
from make_terrain import HOBS, b64, to_i16  # noqa: E402
from make_regions import grid_record, NBOUT  # noqa: E402

LAT_LIMIT = -80.02      # the 20 m mosaic ends at 80 S
M20 = M240 = None
TILES = []              # (name, x0, y0, x1, y1): bounds of every 5 m tile present in data/raw
TILE_CACHE = {}
LOCK = threading.Lock()   # one mask at a time: the kernels already use every core


def index_tiles():
    for p in sorted(glob.glob(os.path.join(lt.RAW, '*_final_adj_5mpp_surf.tif'))):
        with tifffile.TiffFile(p) as t:
            pg = t.pages[0]
            tie = pg.tags['ModelTiepointTag'].value
            h, w = pg.shape
            TILES.append((os.path.basename(p).split('_final')[0], tie[3], tie[4], tie[3] + w * 5.0, tie[4] - h * 5.0))


def tile_for(x, y, margin=500.0):
    """A 5 m tile that contains the point with some margin, so the near field surrounds it."""
    for name, x0, y0, x1, y1 in TILES:
        if x0 + margin < x < x1 - margin and y1 + margin < y < y0 - margin:
            if name not in TILE_CACHE:
                TILE_CACHE.clear()          # one tile in memory at a time
                TILE_CACHE[name] = lt.load_tile(name)
            if not np.isnan(lt._bil(*TILE_CACHE[name], x, y)):
                return name, TILE_CACHE[name]
    return None, lt.NO_TILE


def mask_record(lat, lon):
    x, y = lt.ll_to_xy(lat, lon)
    name, tile = tile_for(float(x), float(y))
    rec = {'dem': (['5 m'] if name else []) + ['20 m', '240 m'], 'tile': name, 'mask': {}, 'computed': time.strftime('%Y-%m-%d'), 'by': 'tools/terrain/serve.py'}
    for hobs in HOBS:
        mask, dist, hg = lt.horizon_mask(*tile, M20, M240, float(x), float(y), hobs, lt.NB, True, True)
        rec['mask']['%g' % hobs] = b64(to_i16(mask))
        if hobs == HOBS[0]:
            rec['dist'] = b64(np.clip(np.round(dist / 10), 0, 65535).astype('<u2'))
            rec['stats'] = {'min_deg': round(float(mask.min()), 2), 'max_deg': round(float(mask.max()), 2), 'max_dist_km': round(float(dist.max()) / 1000, 1)}
    if np.isnan(hg):
        raise ValueError('no LOLA height at this point')
    rec['h_m'] = round(float(hg), 1)
    rec['slope'] = {}
    if name:
        rec['slope']['5m'] = round(float(lt.slope_bspline(*tile, float(x), float(y))), 1)
    rec['slope']['20m'] = round(float(lt.slope_bspline(M20, -304000.0, 304000.0, 20.0, float(x), float(y))), 1)
    return rec


def grid_row(lat, lon, n, d, row):
    """One row (south to north: row 0 is the southernmost) of an n x n grid of masks at d metres around a point,
    exactly as tools/terrain/make_regions.py builds them. The page asks row by row so it can show progress."""
    x, y = lt.ll_to_xy(lat, lon)
    name, tile = tile_for(float(x), float(y), margin=(n - 1) / 2 * d + 600.0)
    gm, gh, gs = grid_record(tile, M20, M240, float(x), float(y), n, d, rows=[row])
    if any(np.isnan(v) for v in gh):
        raise ValueError('no LOLA height at part of this grid')
    return {'row': row, 'n': n, 'spacing_m': d, 'nb': NBOUT, 'hobs_m': 2.0, 'masks': b64(gm), 'h': gh, 'slope': gs,
            'dem': (['5 m'] if name else []) + ['20 m', '240 m'], 'slope_grid': '5 m' if name else '20 m'}


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b'')

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == '/ping':
                self._send(200, {'ok': True, 'service': 'lunar-window-browser terrain helper', 'south_of_deg': LAT_LIMIT, 'hobs_m': HOBS, 'nb': lt.NB, 'tiles': [t[0] for t in TILES]})
            elif u.path == '/mask':
                q = parse_qs(u.query)
                lat, lon = float(q['lat'][0]), float(q['lon'][0])
                if not (-90 <= lat <= LAT_LIMIT):
                    self._send(400, {'error': 'terrain is available south of 80 S only'}); return
                t0 = time.time()
                with LOCK:
                    rec = mask_record(lat, lon)
                print('mask %.4f %.4f  %s  %.2f s' % (lat, lon, '+'.join(rec['dem']), time.time() - t0), flush=True)
                self._send(200, rec)
            elif u.path in ('/', '/index.html'):
                self._send(200, open(os.path.join(lt.ROOT, 'dist', 'lunar-window-browser.html'), 'rb').read(), 'text/html; charset=utf-8')
            elif re.fullmatch(r'/regions/[a-z0-9_-]+\.js', u.path):
                f = os.path.join(lt.ROOT, 'dist', 'regions', os.path.basename(u.path))
                if os.path.exists(f):
                    self._send(200, open(f, 'rb').read(), 'application/javascript')
                else:
                    self._send(404, {'error': 'not found'})
            elif u.path == '/grid':
                q = parse_qs(u.query)
                lat, lon = float(q['lat'][0]), float(q['lon'][0])
                n, d, row = int(q.get('n', ['21'])[0]), float(q.get('d', ['50'])[0]), int(q['row'][0])
                if not (-90 <= lat <= LAT_LIMIT):
                    self._send(400, {'error': 'terrain is available south of 80 S only'}); return
                if not (3 <= n <= 41 and n % 2 == 1 and 10 <= d <= 200 and 0 <= row < n):
                    self._send(400, {'error': 'n must be odd, 3 to 41; d 10 to 200 m; row 0 to n-1'}); return
                t0 = time.time()
                with LOCK:
                    rec = grid_row(lat, lon, n, d, row)
                print('grid %.4f %.4f  row %d/%d  %.1f s' % (lat, lon, row + 1, n, time.time() - t0), flush=True)
                self._send(200, rec)
            else:
                self._send(404, {'error': 'not found'})
        except Exception as e:  # report, keep serving
            self._send(500, {'error': str(e)})

    def log_message(self, *a):
        pass


def main():
    global M20, M240
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8791)
    a = ap.parse_args()
    print('loading DEMs ...', flush=True)
    M20 = lt.load_m20()[0]; M240 = lt.load_m240()[0]
    index_tiles()
    mask_record(-89.0, 0.0)     # compile the numba kernels before the first request
    print('terrain helper ready: http://127.0.0.1:%d/  (%d 5 m tiles)' % (a.port, len(TILES)), flush=True)
    ThreadingHTTPServer(('127.0.0.1', a.port), H).serve_forever()


if __name__ == '__main__':
    main()
