# Basin Shaper

Shape rain gardens and retention basins from a rough footprint and export the geometry for flood models (ArcGIS Pro, QGIS, PluvioFlow).

Import a footprint (shapefile or GeoJSON), set storage depth, freeboard and side slope (or a target volume), and export:

- shapefiles for the rim, design water level, bottom, permanent pool and depth contours
- an ESRI ASCII depth raster aligned to your DEM grid, for burning basins into the DEM
- stage–storage and summary tables

Part of the MSc thesis *Rain Gardens and Retention Areas: Evaluating Distributed Nature-Based Solutions in Dynamic Urban Flood Modelling* (SLU, EX0852).

## Getting started

Needs [Node.js](https://nodejs.org) (LTS).

```bash
npm install      # once, downloads the dev tools into node_modules/
npm run dev      # starts the app at http://localhost:5173 and reloads on save
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | runs the engine tests (volumes, contours, file formats) |
| `npm run typecheck` | checks all TypeScript types |
| `npm run build` | writes `dist/index.html`, one self-contained file that runs offline |

## Project layout

```
src/
  engine/          pure TypeScript, no browser APIs — reusable in PluvioFlow
    types.ts       Pt, Ring, DistanceField, DesignParams, Evaluation, StageRow
    geometry.ts    polygon helpers: area, point-in-polygon, smoothing, ring orientation
    basin.ts       distance field, volumes, depth/scale solvers, contours, stage–storage
    projection.ts  lon/lat → UTM / SWEREF99 TM
    index.ts       public API
  io/              file formats: zip, shapefile + dbf, ESRI ASCII grid, CRS / .prj text
  app/             the web app
    model.ts       basin state, presets, solve()
    importer.ts    shapefile / GeoJSON import
    exporter.ts    shapefile, raster, CSV export
    draw.ts        plan view, cross-section, stage–storage canvas drawing
    examples.ts    example basins shown on first load
  main.ts          wires the page to everything above
  styles.css
index.html         page markup
test/              vitest tests
```

## How the geometry works

A basin is excavated inside the footprint with constant side slopes 1 : m. At a point whose shortest distance to the rim is d, the excavation depth is

    depth(d) = min(T, d / m),   T = freeboard + storage depth + permanent pool

So the outline at depth z is the set of points with d = z·m, an inward offset of the footprint. The engine samples d on a fine grid (≈260 cells across the basin), integrates volumes from it, and extracts outlines with marching squares. A 20 × 10 m test basin matches the prismoidal formula (see `test/engine.test.ts`).

- **Set depth → volume**: evaluate directly.
- **Set volume → depth**: bisection on storage depth, keeping the bottom at least the minimum bottom width.
- **Set volume → size**: bisection on a scale factor about the footprint centroid (distances scale linearly, so the field is reused).

The depth raster uses the exact distance at each cell centre, so its volume converges to the design volume as the cell size shrinks. `summary.csv` reports how much of the design storage a given cell size keeps.

## Using the engine from PluvioFlow

```ts
import { buildField, evaluate, solveDepth, depthAtWorld } from '../basin-shaper/src/engine';

const field = buildField([footprintRing]);                // projected metres
const { S } = solveDepth(field, { S: 0, F: 0.1, m: 3, minB: 0.6 }, 25); // 25 m³ live storage
const design = { S, F: 0.1, m: 3 };
const result = evaluate(field, design);                   // areas and volumes
const d = depthAtWorld(field, design, x, y);              // burn depth at a DEM cell centre
```
