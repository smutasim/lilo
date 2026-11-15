# Lunar Window Browser

Compare lunar landing sites and dates by where the Sun and Earth sit against the local skyline.
Built for the NASA Space Apps 2026 challenge *Lunar Landing Site Navigator*.

**AI acknowledgement.** The code and text of this project were generated with AI (Anthropic Claude, via Claude Code),
directed by Sharif Mutasim. Every number in the tool comes from the NASA data and cited sources below, not from the AI.

**NASA data and resources used.**
- LOLA terrain: NASA GSFC Planetary Geodesy Data Archive (PGDA) 5 m site models, 20 m polar mosaic, error clones and
  average-illumination maps; PDS `LDEM_60S_240M`.
- LROC WAC mosaics (PDS `LROLRC_2001`).
- GRAIL gravity model GRGM1200A (NASA GSFC, PDS Geosciences node).
- JPL Horizons (satellite states and validation).
- JPL / NAIF SPICE: DE440 ephemeris and lunar frame kernels.
- DSN 810-005 (ground-station locations).

Open `dist/lunar-window-browser.html` in a browser. It is one self-contained file (about 6.8 MB). The only network
request is the astronomy-engine script (star field and out-of-span fallback). The page uses system fonts.

## What it does

The page looks like desktop engineering software (tabs, bordered panels, data grids, status bar). One light look; only
the sky viewport is dark.

**Site analysis.** Left: panels for site, analysis period (start date and time, length 3 to 120 days or a custom
1 to 365), constraints (array height 0, 2, 5, 10, 20, 50 or 100 m, each with its own exact LOLA skyline), satellites, ground stations and the observer on
Earth. Centre: a viewport (Sky view with the LOLA skyline and the Sun and Earth as finite disks; Sky plot; Terrain 3D;
From Earth) and a timeline with rows for the Sun, the Earth, each shown satellite and "Constraints met". Type a time
(UTC or the observer's local time), play at 1 min/s to 4 days/s, step with the arrow keys, jump between windows. Right:
status now (time to the next rise or set), statistics for the next 7, 14 or 30 days, and the windows that meet your
constraints. Below: Skyline ("The skyline, all the way round"), Landing date, Maps, Terrain uncertainty, Model.

**From Earth** (for the public). The Moon in the sky of a place on Earth (Goldstone DSS-14 by default, or a city or
postal code, or your location): its phase, the libration of that moment, the landing site on the disk, atmospheric
refraction, and whether a lander there could talk to that place now. Moon position checked against JPL Horizons
(`tests/validate_fromearth.py`, 0.0005 deg).

**Compare sites.** All sites in one sortable table (19 cited sites plus your own: one at a time or a pasted list).
Tick two to compare them side by side for one day. Exports CSV.

**Site finder.** Enter a landing date, surface stay and an area. Filter first on two derived scores (Solar score and
Earth score, 0 to 100, defined in the Method tab), then on their parts (mean irradiance, lowest 24 h mean, longest
darkness, Earth link, longest outage) and slope, each with a two-ended slider or typed limits; setting a part freezes
its score. The page evaluates 3,600 real LOLA horizons from 85 S to the pole, shows which range removes how many, and
lists the candidates in a sortable, filterable table shaded from worst to best. "Open in Site view" opens a candidate.

**Method.** Models, sources and checks, including orbit propagation error against JPL Horizons.

## What is different: satellites with validated propagation

Real lunar orbiters are propagated numerically (`src/prop.js`: GRAIL GRGM1200A gravity, Earth and Sun as third
bodies), checked against JPL Horizons and SPICE (`tests/check_prop.js`).
`data/sats.json` is a built-in catalogue (LRO, Danuri, Chandrayaan-2, ARTEMIS-P1 and -P2): one Horizons state each
at a stated epoch, with the measured error against Horizons. You can also enter a state vector (full force model or
two-body) or paste a Horizons vector table.

Ticked satellites are drawn in the sky view and sky plot with their track, get a timeline row with exact rise and set
times against the LOLA skyline, and appear in Status. The tick "Use as a relay to Earth" makes a satellite count toward
the link. A built-in satellite is propagated automatically only while the timeline overlaps the span over which it
was checked against Horizons; otherwise the row offers "Propagate anyway". Limit: link percentages sample a relay
every 10 min (1 h in the landing-date table and the finder), so shorter passes are under-sampled there; the timeline
row and the rise and set times are exact.

Also:
- **Quantities, not ratings.** Windows are whatever meets the constraints you enter; no lander requirement is built in.
- **Solar strength, not watts.** Irradiance on a Sun-facing surface; no array model (see the Model table).
- **Uncertainty.** At the ten sites with PGDA error clones: skyline scatter and the range of each headline number
  across 16 clone models. Elsewhere the page says it is not quantified.
- **Share and export.** View and constraints in the URL hash; CSV with every assumption written in.

## Terrain helper

```bash
.venv/Scripts/python tools/terrain/serve.py     # needs data/raw; then open http://127.0.0.1:8791/
```

It serves the page and computes a horizon mask for any point south of 80 S in about a second, with the same code
that built the shipped masks. The page also finds it when opened from a file. It binds to 127.0.0.1 only.

## Model

| Part | Source |
| --- | --- |
| Sun, Earth | SPICE, DE440 (`de440s.bsp`), apparent `LT+S`, frame `MOON_ME` (`moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`), 2 h grid 2026-09-01 to 2030-01-01, Catmull-Rom interpolation in the browser; outside that span astronomy-engine + IAU rotation model, with a badge |
| Terrain | PGDA LOLA 5 m site tiles and 20 m polar mosaic (Barker et al. 2021), PDS LDEM_60S_240M. Rays to 55 km plus a 3D scatter of every pixel to 400 km. 1440 azimuth bins, 0.01 deg; observer 0, 2, 5, 10, 20, 50 or 100 m, one exact mask per height |
| Disks | Sun radius 695,700 km, Earth 6,378 km, at the actual distance |
| Irradiance | IAU 2015 Resolution B3 nominal total solar irradiance, 1361 W/m2 at 1 au, x (1 au / distance)^2 x visible fraction of a uniform disk, on a Sun-facing surface |
| Finder survey | one horizon mask per 5.04 km cell from 85 S to the pole, at the cell's brightest pixel of PGDA AVGVISIB_85S_060M; 720 bins, 2 m observer (`data/survey.json`) |
| Satellite orbits | `src/prop.js`: GRGM1200A gravity (degree 60, 30, 16 or 8 by periapsis altitude), Earth and Sun point masses (DE440 GM), Adams-Bashforth-Moulton integrator; state from JPL Horizons. Checked by `tests/check_prop.js` |
| Events | 10-min samples, edges bisected to 1 s |
| Uncertainty | horizons recomputed on PGDA LOLA error clones 0001-0016 (Barker et al. 2021); min and max reported |
| Ground stations | DSS-14, DSS-43, DSS-63 and the 10.0 deg generic transmit limit from DSN 810-005, Module 301, Rev. N |

Validation against JPL Horizons, Barker et al. 2021 and the PGDA illumination maps: `tests/validate_*.py`, `tests/check_*.js` (`npm test`).
Not modelled: electrical power, thermal limits, link budgets, GNSS geometry, maneuvers, terrain north of 60 S (smooth sphere), rocks and craters below the grid spacing. Nothing here is flight-grade.

## Build and test

Node 18+ for build and tests. Python 3.11 (own venv) only for regenerating data and for validation.

```bash
npm install
npm run build                    # -> dist/lunar-window-browser.html
npm test                         # core checks (check_core.js) and propagator checks (check_prop.js --quick)

python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt   # Windows path shown
.venv/Scripts/python -m playwright install chromium
npm run test:ui                  # click-through + screenshots in tests/out (tests/screenshot.py)
npm run validate:horizons        # network
npm run validate:fromearth       # network; Moon from DSS-14 against Horizons (build first)
npm run validate:illumination    # needs data/raw
```

`test:ui` and the validate scripts call `python`; activate the venv first.

## Regenerating data (optional; outputs are committed)

```bash
npm run data:ephem               # downloads NAIF kernels to tools/ephem/kernels, writes data/ephem.json
npm run data:terrain             # data/terrain.json and derived coordinates in data/sites.json
npm run data:clones              # data/clones.json: 16 clones per tile (about 11 GB in turn), deleted after use
npm run data:polar               # data/polar.json
npm run data:sky                 # stars, constellations, Milky Way, Earth land mask
npm run data:survey              # data/survey.json: 3,600 masks for the finder
npm run data:sats                # data/gravity.json, data/sats.json and the Horizons tables in tests/data (network)
```

`data:terrain` and `data:polar` need these files in `data/raw/` (about 3.7 GB, not committed):

| File | From |
| --- | --- |
| `LDEM_80S_20MPP_ADJ.TIF` | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/ |
| `<Site>_final_adj_5mpp_surf.tif` for Site01, Site04, Site06, Site07, Site11, Site20v2, Site23, Site42, DM2, Haworth | https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/&lt;Site&gt;/ |
| `ldem_60s_240m.img` and `.lbl` | PDS Geosciences, `lrolol_1xxx/data/lola_gdr/polar/img/` |
| `AVGVISIB_85S_060M_201608.TIF` (and `_EARTH`) | https://pgda.gsfc.nasa.gov/data/MoonIllumination/ |

## Layout

```
src/core.js              geometry, masks, disks, events, irradiance, metrics (page + Node tests)
src/prop.js              orbit propagator (page + Node tests)
src/app/*.js             the page: state, compute, satellites and stations, sky, sky plot, 3D terrain, timeline and maps, finder, compare, UI
src/index.template.html, src/style.css, src/views/*.html
data/sites.json          cited site list (hand-written; derived coordinates filled by make_terrain.py)
data/*.json              generated: ephem, terrain, clones, survey, polar, sky, gravity, sats
tools/ephem, terrain, imagery, sats   offline generators (Python)
tests/                   check_core.js, check_prop.js, check_comms.py, screenshot.py, validate_*, check_helper.py
backup/                  pre-redesign sources of 2026-11-14 (not in git)
```

## Licence

Apache License 2.0 (`LICENSE`, `NOTICE`), as the NASA Space Apps terms provide for original content. Third-party
software, data and services keep their own licences: `THIRD_PARTY_NOTICES.md`.

## Credits

LOLA: Smith et al. (PDS LRO-L-LOLA-4-GDR-V1.0); Barker et al. 2021, Planet. Space Sci. 203, 105119;
Mazarico et al. 2011, Icarus 211, 1066. Solar constants: IAU 2015 Resolution B3 (arXiv:1510.07674). Ground stations: DSN 810-005, Module 301, Rev. N. Ephemerides and kernels: JPL / NAIF. Site coordinates: LROC, NASA and the
papers cited in `data/sites.json`. Hipparcos via d3-celestial; Natural Earth via world-atlas; astronomy-engine.
Place search by Open-Meteo.com (CC BY 4.0), location data based on GeoNames. Air mass: Kasten and Young 1989 (display
only). Refraction: Saemundsson formula as given by Meeus, via astronomy-engine.
