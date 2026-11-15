"""Whole-Moon base image for the page's "Whole Moon" map.

Source: LROC WAC global morphologic mosaic, WAC_GLOBAL_E000N0000_008P.TIF (PDS LROLRC_2001 EXTRAS/BROWSE/WAC_GLOBAL;
label: "WAC monochrome global mosaic with large incidence angles (53-70 degrees at the equator) ... Simple Cylindrical
projection of the entire Moon, centered on the near side, at 8 px/deg", Speyerer et al. 2011). 2880 x 1440 px,
tiepoint (-pi R, +pi R / 2) so columns run 180W -> 180E and rows 90N -> 90S, which is the page map's grid.
The file is fetched once into data/raw/lroc_global (4.2 MB). Output: data/imagery_global.json, a 1440 x 720 JPEG
(2 x 2 box average). Display only: no number in the page is computed from it.
"""
import base64, json, os, sys, urllib.request
import numpy as np, tifffile, imagecodecs

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAME = 'WAC_GLOBAL_E000N0000_008P.TIF'
URL = ('https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/WAC_GLOBAL/' + NAME)
RAW = os.path.join(ROOT, 'data', 'raw', 'lroc_global', NAME)

if not os.path.exists(RAW):
    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    urllib.request.urlretrieve(URL, RAW)          # the LROC node redirects to pds.mcp.nasa.gov
t = tifffile.TiffFile(RAW); p = t.pages[0]; tg = p.tags
R = 1737400.0
scale = tg['ModelPixelScaleTag'].value; tie = tg['ModelTiepointTag'].value
a = p.asarray().astype(np.float64)
H, W = a.shape
assert (H, W) == (1440, 2880), a.shape
assert abs(scale[0] * W - 2 * np.pi * R) < 1, scale                  # 360 deg across
assert abs(tie[3] + np.pi * R) < 1 and abs(tie[4] - np.pi * R / 2) < 1, tie   # starts at 180W, 90N
assert 'Equirectangular' in tg['GeoAsciiParamsTag'].value
nod = a == 0                                                         # GDAL_NODATA 0
b = a.reshape(H // 2, 2, W // 2, 2)
m = (~nod).reshape(H // 2, 2, W // 2, 2).sum(axis=(1, 3))
s = np.where(m > 0, b.sum(axis=(1, 3)) / np.maximum(m, 1), 0)
v = s[s > 0]; lo, hi = np.percentile(v, 0.5), np.percentile(v, 99.8)
out = np.clip((s - lo) / (hi - lo) * 255, 0, 255)
jp = base64.b64encode(imagecodecs.jpeg8_encode(out.astype(np.uint8), level=80)).decode()
rec = {'w': W // 2, 'h': H // 2, 'jpeg': jp,
       'source': 'LROC WAC global morphologic mosaic (Speyerer et al. 2011), %s, 8 px/deg box-averaged to 4 px/deg; '
                 'incidence 53-70 deg at the equator; stretch %.0f-%.0f DN' % (NAME, lo, hi),
       'note': 'simple cylindrical, columns 180W to 180E, rows 90N to 90S'}
json.dump(rec, open(os.path.join(ROOT, 'data', 'imagery_global.json'), 'w'))
print('wrote data/imagery_global.json', len(jp), 'b64 bytes; no-data share %.4f' % nod.mean())
