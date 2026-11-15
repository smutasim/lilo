"""Print the georeferencing of the raw DEM GeoTIFFs (run before trusting any grid)."""
import sys, glob, tifffile
for p in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else 'data/raw/*.[tT][iI][fF]')):
    with tifffile.TiffFile(p) as t:
        pg = t.pages[0]
        tg = pg.tags
        def g(n): return tg[n].value if n in tg else None
        print(p, pg.shape, pg.dtype, 'compr', pg.compression.name, 'tiled' if pg.is_tiled else 'strips',
              '\n  scale', g('ModelPixelScaleTag'), 'tie', g('ModelTiepointTag'), 'nodata', g('GDAL_NODATA'),
              '\n  geokeys', {k: v for k, v in (pg.geotiff_tags or {}).items() if k not in ('ModelPixelScale', 'ModelTiepoint')})
