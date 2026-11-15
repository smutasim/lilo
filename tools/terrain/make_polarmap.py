"""Build data/polar.json: a 312 x 312 base map of the south polar cap (+-149.76 km, 960 m/px) for the app.

  shade  uint8  shaded relief of PDS LDEM_60S_240M block-averaged 4x4 (fixed light from the upper left;
                a drawing aid, not the current lighting)
  illum  uint8  PGDA AVGVISIB_85S_060M_201608 block-averaged 16x16: 18.6-year average solar visibility
                (Mazarico et al. 2011), 0..255 = 0..100 %

Map convention as in lolaterrain.py: x = r sin(lon) to the right, y = r cos(lon) up (0 deg E at the top).
"""
import base64, json, os, sys
import numpy as np
import tifffile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lolaterrain as lt

N, F = 312, 4
m240 = lt.load_m240()[0]
c = 3880
h = m240[c - N * F // 2:c + N * F // 2, c - N * F // 2:c + N * F // 2].reshape(N, F, N, F).mean(axis=(1, 3))
gy, gx = np.gradient(h, 960.0)            # gy: +row = -y (south on the page), gx: +col = +x
shade = np.clip(0.55 + 2.2 * (-gx * -0.7071 - gy * -0.7071), 0, 1)   # light from upper left
av = tifffile.imread(os.path.join(lt.RAW, 'AVGVISIB_85S_060M_201608.TIF')).astype(np.float32)
av[av < 0] = 0
o = (5058 - N * 16) // 2
il = av[o:o + N * 16, o:o + N * 16].reshape(N, 16, N, 16).mean(axis=(1, 3)) * 0.00004
out = {'n': N, 'px_m': 960, 'half_m': N * 960 / 2,
       'note': 'south polar stereographic, x right = 90E, y up = 0E; shade: LDEM_60S_240M relief; illum: AVGVISIB_85S_060M_201608',
       'shade': base64.b64encode((shade * 255).astype(np.uint8).tobytes()).decode(),
       'illum': base64.b64encode(np.clip(il * 255, 0, 255).astype(np.uint8).tobytes()).decode()}
json.dump(out, open(os.path.join(lt.ROOT, 'data', 'polar.json'), 'w'))
print('wrote data/polar.json', os.path.getsize(os.path.join(lt.ROOT, 'data', 'polar.json')), 'bytes; illum max %.2f' % il.max())
