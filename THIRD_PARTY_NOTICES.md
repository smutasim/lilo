# Third-party software, data and services

The Lunar Window Browser's own code and text are licensed under the Apache License 2.0 (`LICENSE`, `NOTICE`).
Everything below comes from someone else, keeps its own licence, and is listed here as the NASA Space Apps terms
require ("Use of Third-Party Materials"). Nothing here is export-controlled.

## Built into the page (`dist/`)

| Material | Where it is used | Licence / terms | Source |
| --- | --- | --- | --- |
| astronomy-engine 2.1.19, Don Cross | Loaded by the page from jsDelivr: star field, Earth texture frame, ground stations, fallback ephemeris, From Earth view | MIT | https://github.com/cosinekitty/astronomy |
| d3-celestial 0.7.35 data (stars to magnitude 6, constellation lines, star names, Milky Way outline), Olaf Frohn | Baked into `data/sky.json` by `tools/skydata.js` | BSD-3-Clause | https://github.com/ofrohn/d3-celestial |
| world-atlas 2.0.2 (Natural Earth 1:110m land), Mike Bostock | Earth land mask in `data/sky.json` | ISC (Natural Earth data: public domain) | https://github.com/topojson/world-atlas, https://www.naturalearthdata.com |
| topojson-client 3.1.0, Mike Bostock | Build step only (`tools/skydata.js`) | ISC | https://github.com/topojson/topojson-client |

## Online service called by the page

| Service | Use | Terms |
| --- | --- | --- |
| Open-Meteo geocoding API | "Observer on Earth" place search; called only when the user presses Find, with only the typed text | API data under CC BY 4.0, attribution shown next to the search: "Place search by Open-Meteo.com". Location data based on GeoNames (https://www.geonames.org). https://open-meteo.com/en/licence |

The browser's own time-zone database (Intl) and geolocation (only on "Use my location", kept in the browser) are used
as provided by the user's browser.

## NASA and other space-agency data (public, cited per item in the Method tab and README)

- LOLA terrain: NASA GSFC Planetary Geodesy Data Archive (PGDA) 5 m site models, 20 m polar mosaic, error clones
  (Barker et al. 2021) and average-illumination maps; PDS `LDEM_60S_240M` (LRO-L-LOLA-4-GDR-V1.0).
- LROC WAC mosaics (PDS LROC node; `WAC_ROI_SOUTH_SUMMER_100M`, global mosaic).
- GRAIL gravity model GRGM1200A (NASA GSFC PGDA, PDS Geosciences node).
- JPL Horizons System (satellite states, validation tables).
- JPL / NAIF SPICE: DE440 ephemeris (`de440s.bsp`), `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `naif0012.tls`,
  `gm_de440.tpc`.
- DSN 810-005, Module 301, Rev. N (ground-station coordinates, elevation limits).
- Site coordinates: LROC, NASA mission pages and the papers cited per site in `data/sites.json`.
- Educational links in the page go to NASA pages only (svs.gsfc.nasa.gov, science.nasa.gov, nasa.gov, lola.gsfc.nasa.gov,
  pgda.gsfc.nasa.gov).

## Development tools (not redistributed)

Python (offline data build and tests): spiceypy (MIT), NumPy (BSD-3-Clause), Numba (BSD-2-Clause), tifffile
(BSD-3-Clause), imagecodecs (BSD-3-Clause), Playwright (Apache-2.0).
Node.js runs the build (`tools/build.js`) and tests.

## AI assistance

Code and text were generated with Anthropic Claude (via Claude Code), directed by Sharif Mutasim. Every number in
the tool comes from the data and sources above, not from the AI.
