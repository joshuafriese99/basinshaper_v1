/** Build the GIS export: shapefiles, depth rasters, CSV tables, README. */
import { bbox, closeRing, depthAtWorld, scaleRings, stageStorage, toPolygons, type Ring } from '../engine';
import { zip, type ZipEntry } from '../io/zip';
import { SHP_POLYGON, SHP_POLYLINE, writeDbf, writeShp, type DbfField, type ShpFeature } from '../io/shapefile';
import { asciiGrid } from '../io/asciigrid';
import { CRS_LIST } from '../io/crs';
import { field, outline, ringsOf, solve, state, type Basin } from './model';

export interface RasterSettings {
  /** cell size, m */
  cs: number;
  /** snap origin */
  ox: number;
  oy: number;
  /** wet ponds: burn only to the permanent pool surface */
  poolFilled: boolean;
}

export interface Raster {
  nc: number; nr: number; x0: number; y0: number; cs: number;
  /** excavation depth, m (0 outside basins), top row first */
  depth: Float32Array;
  /** absolute surface elevation, NaN where no rim elevation */
  surf: Float32Array;
  /** live storage kept by the raster, per basin id */
  perVol: Map<number, number>;
  hasSurf: boolean;
}

export const prjText = (): string => (state.crs === 'src' ? state.srcPrj ?? '' : CRS_LIST.find(c => c.id === state.crs)?.wkt ?? '');

const worldRim = (b: Basin) => scaleRings(ringsOf(b), field(b).c, b.p.s);

/** Live storage the raster keeps for one basin (cheap estimate for the UI). */
export function rasterVolume(b: Basin, r: RasterSettings): { cells: number; vol: number } | null {
  const fld = field(b), [x0, y0, x1, y1] = bbox(worldRim(b));
  const c0 = Math.floor((x0 - r.ox) / r.cs), c1 = Math.ceil((x1 - r.ox) / r.cs);
  const r0 = Math.floor((y0 - r.oy) / r.cs), r1 = Math.ceil((y1 - r.oy) / r.cs);
  if ((c1 - c0) * (r1 - r0) > 400_000) return null;
  const cap = b.p.type === 'wet' && r.poolFilled ? b.p.F + b.p.S : Infinity;
  let cells = 0, vol = 0;
  for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) {
    const d = Math.min(cap, depthAtWorld(fld, b.q, r.ox + (j + 0.5) * r.cs, r.oy + (i + 0.5) * r.cs));
    if (d > 0) { cells++; vol += Math.max(0, Math.min(d, b.p.F + b.p.S) - b.p.F) * r.cs * r.cs; }
  }
  return { cells, vol };
}

export function buildRaster(basins: Basin[], r: RasterSettings): Raster | { tooBig: true } | null {
  if (!basins.length) return null;
  const { cs, ox, oy } = r;
  const items = basins.map(b => ({ b, fld: field(b), bb: bbox(worldRim(b)) }));
  const [bx0, by0, bx1, by1] = bbox(items.map(i => [[i.bb[0], i.bb[1]], [i.bb[2], i.bb[3]]] as Ring));
  const x0 = Math.floor((bx0 - ox) / cs) * cs + ox - cs, y0 = Math.floor((by0 - oy) / cs) * cs + oy - cs;
  const nc = Math.ceil((bx1 - x0) / cs) + 1, nr = Math.ceil((by1 - y0) / cs) + 1;
  if (nc * nr > 25e6) return { tooBig: true };
  const depth = new Float32Array(nc * nr), surf = new Float32Array(nc * nr).fill(NaN);
  const perVol = new Map<number, number>();
  for (const { b, fld, bb } of items) {
    let V = 0;
    const c0 = Math.max(0, Math.floor((bb[0] - x0) / cs) - 1), c1 = Math.min(nc - 1, Math.ceil((bb[2] - x0) / cs) + 1);
    const r0 = Math.max(0, Math.floor((bb[1] - y0) / cs) - 1), r1 = Math.min(nr - 1, Math.ceil((bb[3] - y0) / cs) + 1);
    const cap = b.p.type === 'wet' && r.poolFilled ? b.p.F + b.p.S : Infinity;
    for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) {
      let d = depthAtWorld(fld, b.q, x0 + (j + 0.5) * cs, y0 + (i + 0.5) * cs);
      if (d <= 0) continue;
      d = Math.min(d, cap);
      const k = (nr - 1 - i) * nc + j;
      if (d > depth[k]) depth[k] = d;
      if (b.p.rimZ != null) surf[k] = Math.min(isNaN(surf[k]) ? Infinity : surf[k], b.p.rimZ - d);
      V += Math.max(0, Math.min(d, b.p.F + b.p.S) - b.p.F) * cs * cs;
    }
    perVol.set(b.id, V);
  }
  return { nc, nr, x0, y0, cs, depth, surf, perVol, hasSurf: basins.some(b => b.p.rimZ != null) };
}

const N = (name: string, len = 12, dec = 3): DbfField => ({ name, type: 'N', len, dec });
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

function shpSet(base: string, feats: ShpFeature[], type: number, fields: DbfField[], rows: Record<string, unknown>[]): ZipEntry[] {
  const w = writeShp(feats, type);
  const out: ZipEntry[] = [
    { name: base + '.shp', data: w.shp }, { name: base + '.shx', data: w.shx },
    { name: base + '.dbf', data: writeDbf(fields, rows) }, { name: base + '.cpg', data: 'UTF-8' },
  ];
  const prj = prjText();
  if (prj) out.push({ name: base + '.prj', data: prj });
  return out;
}

export function stageCsv(basins: Basin[]): string {
  const L = ['basin,type,stage_above_bottom_m,depth_below_rim_m,elevation_m,water_surface_m2,volume_m3'];
  for (const b of basins) for (const r of stageStorage(field(b), b.q, 40)) {
    L.push([quote(b.name), b.p.type, r.stage.toFixed(3), r.depthBelowRim.toFixed(3),
      b.p.rimZ != null ? (b.p.rimZ - r.depthBelowRim).toFixed(3) : '', r.area.toFixed(2), r.vol.toFixed(2)].join(','));
  }
  return L.join('\n') + '\n';
}

const polygonParts = (rings: Ring[]): Ring[] => toPolygons(rings).flatMap(poly => poly.map(closeRing));

export function buildExport(basins: Basin[], rs: RasterSettings, contourInterval: number): { zip: Uint8Array; warnings: string[] } {
  basins.forEach(solve);
  const files: ZipEntry[] = [], warnings: string[] = [];
  const z = (b: Basin) => b.p.rimZ;

  // rim polygons with all design attributes
  const rimFields: DbfField[] = [
    { name: 'name', type: 'C', len: 60 }, { name: 'type', type: 'C', len: 12 },
    N('rim_m2', 12, 2), N('wl_m2', 12, 2), N('bot_m2', 12, 2), N('stor_m', 8, 3), N('fb_m', 8, 3), N('pool_m', 8, 3), N('tot_m', 8, 3), N('slope_1in', 8, 2),
    N('v_live_m3', 12, 2), N('v_fb_m3', 12, 2), N('v_pool_m3', 12, 2), N('v_media_m3', 12, 2), N('v_eff_m3', 12, 2), N('v_exc_m3', 12, 2),
    N('rim_z', 10, 3), N('wl_z', 10, 3), N('bot_z', 10, 3), N('media_m', 8, 3), N('porosity', 6, 3), N('infil_mmh', 8, 2),
    N('catch_m2', 12, 1), N('runoff_c', 6, 3), N('scale', 8, 4),
  ];
  const rimRows = basins.map(b => {
    const r = b.res, P = b.p, rz = z(b);
    return {
      name: b.name, type: P.type, rim_m2: r.rimA, wl_m2: r.Awl, bot_m2: r.Abot, stor_m: P.S, fb_m: P.F, pool_m: P.type === 'wet' ? P.P : 0, tot_m: r.T, slope_1in: P.m,
      v_live_m3: r.Vlive, v_fb_m3: r.Vfb, v_pool_m3: r.Vdead, v_media_m3: r.Vmedia, v_eff_m3: r.Veff, v_exc_m3: r.Vtot,
      rim_z: rz, wl_z: rz == null ? null : rz - P.F, bot_z: rz == null ? null : rz - r.T,
      media_m: P.type === 'raingarden' ? P.media : 0, porosity: P.type === 'raingarden' ? P.por : 0, infil_mmh: P.inf,
      catch_m2: P.CA, runoff_c: P.C, scale: P.s,
    };
  });
  files.push(...shpSet('basins_rim', basins.map(b => ({ parts: polygonParts(worldRim(b)) })), SHP_POLYGON, rimFields, rimRows));

  // level polygons
  const levelFields: DbfField[] = [{ name: 'name', type: 'C', len: 60 }, N('depth_m', 8, 3), N('elev_m', 10, 3)];
  const level = (base: string, list: Basin[], depthOf: (b: Basin) => number) => {
    const feats: ShpFeature[] = [], rows: Record<string, unknown>[] = [];
    for (const b of list) {
      const d = depthOf(b);
      const parts = polygonParts(outline(b, Math.min(d, b.res.T - 1e-6)));
      if (!parts.length) continue;
      feats.push({ parts });
      rows.push({ name: b.name, depth_m: d, elev_m: z(b) == null ? null : z(b)! - d });
    }
    if (feats.length) files.push(...shpSet(base, feats, SHP_POLYGON, levelFields, rows));
  };
  level('basins_waterlevel', basins, b => b.p.F);
  level('basins_bottom', basins, b => b.res.T);
  level('basins_permanent_pool', basins.filter(b => b.p.type === 'wet'), b => b.p.F + b.p.S);

  // contour lines
  const ci = Math.max(0.01, contourInterval);
  const cFeats: ShpFeature[] = [], cRows: Record<string, unknown>[] = [];
  for (const b of basins) {
    const T = b.res.T, levels: number[] = [];
    for (let k = 0; k * ci < T - 1e-6; k++) levels.push(k * ci);
    levels.push(T - 1e-6);
    for (const d of levels) {
      const rings = outline(b, d);
      if (!rings.length) continue;
      const dd = Math.min(d, T);
      cFeats.push({ parts: rings.map(closeRing) });
      cRows.push({ name: b.name, depth_m: +dd.toFixed(3), elev_m: z(b) == null ? null : z(b)! - dd });
    }
  }
  files.push(...shpSet('basins_contours', cFeats, SHP_POLYLINE, levelFields, cRows));

  // rasters
  const R = buildRaster(basins, rs);
  const prj = prjText();
  if (R && 'tooBig' in R) warnings.push('Raster skipped: too many cells. Increase the cell size.');
  else if (R) {
    files.push({ name: 'basins_depth.asc', data: asciiGrid(R.nc, R.nr, R.x0, R.y0, R.cs, R.depth) });
    if (prj) files.push({ name: 'basins_depth.prj', data: prj });
    if (R.hasSurf) {
      files.push({ name: 'basins_surface.asc', data: asciiGrid(R.nc, R.nr, R.x0, R.y0, R.cs, R.surf) });
      if (prj) files.push({ name: 'basins_surface.prj', data: prj });
    }
  }

  // tables
  const sum = ['name,type,rim_area_m2,water_surface_m2,bottom_area_m2,storage_depth_m,freeboard_m,permanent_pool_m,total_depth_m,side_slope_1_in,live_storage_m3,media_pore_storage_m3,effective_storage_m3,excavation_m3,raster_live_storage_m3,rim_z,water_level_z,bottom_z'];
  for (const b of basins) {
    const r = b.res, rz = z(b);
    const rv = R && !('tooBig' in R) ? R.perVol.get(b.id) : undefined;
    sum.push([quote(b.name), b.p.type, r.rimA.toFixed(2), r.Awl.toFixed(2), r.Abot.toFixed(2), b.p.S.toFixed(3), b.p.F.toFixed(3),
      (b.p.type === 'wet' ? b.p.P : 0).toFixed(3), r.T.toFixed(3), b.p.m, r.Vlive.toFixed(2), r.Vmedia.toFixed(2), r.Veff.toFixed(2), r.Vtot.toFixed(2),
      rv != null ? rv.toFixed(2) : '', rz ?? '', rz == null ? '' : (rz - b.p.F).toFixed(3), rz == null ? '' : (rz - r.T).toFixed(3)].join(','));
  }
  files.push({ name: 'summary.csv', data: sum.join('\n') + '\n' }, { name: 'stage_storage.csv', data: stageCsv(basins) },
    { name: 'README.txt', data: readme(rs, ci) });
  return { zip: zip(files), warnings };
}

function readme(rs: RasterSettings, ci: number): string {
  const crs = state.crs === 'src' ? '(CRS of the imported file)' : state.crs;
  return `Basin Shaper export
===================
CRS: ${crs}. All lengths in metres, volumes in m3.

Layers
- basins_rim.shp             Footprint (top of bank) with all design attributes.
- basins_waterlevel.shp      Design water surface (rim minus freeboard).
- basins_bottom.shp          Flat basin floor.
- basins_permanent_pool.shp  Wet ponds only: permanent water surface.
- basins_contours.shp        Depth contours every ${ci} m (depth_m below rim; elev_m if a rim elevation was set).
- basins_depth.asc           Excavation depth below existing ground (m, positive), ${rs.cs} m cells, 0 outside basins.
- basins_surface.asc         Absolute basin surface elevation (basins with a rim elevation only; NoData elsewhere).
- summary.csv / stage_storage.csv  Design numbers and stage-area-volume tables.

Burning the basins into a DEM
Set Environments > Snap raster and Cell size to your DEM first. The rasters are aligned to origin (${rs.ox}, ${rs.oy}).

ArcGIS Pro, Raster Calculator (depth below existing ground; floor follows terrain):
  Con(IsNull("basins_depth.asc"), "DEM", "DEM" - "basins_depth.asc")

ArcGIS Pro, level floor from a rim elevation:
  Con(IsNull("basins_surface.asc"), "DEM", Min("DEM", "basins_surface.asc"))

QGIS Raster Calculator (depth version):
  "DEM@1" - coalesce("basins_depth@1", 0)   (or gdal_calc with nodata handling)

Notes
- Depth is measured from the rim. Side slopes are 1:n (horizontal:vertical).
- Live storage = volume between the design water level and the bottom (or the permanent pool surface for wet ponds).
- Rain gardens: media pore storage = bottom area x media depth x porosity; it is not part of the DEM. Use infil_mmh in your infiltration model (e.g. Green-Ampt Ks).
- Wet ponds: ${rs.poolFilled ? 'the DEM is burnt only to the permanent pool surface, since that water is already there when the storm starts' : 'the DEM is burnt to the excavated bottom'}.
- On sloping ground the depth raster gives a floor parallel to the terrain. Set a rim elevation for a level floor.
- Check raster_live_storage_m3 in summary.csv: it shows how much of the design volume the chosen cell size keeps.
`;
}

/** Offer a file: via the artifact downloads capability when hosted on claude.ai, else a normal browser download. */
export async function saveFile(name: string, data: Uint8Array | string): Promise<string> {
  const blob = new Blob([data as BlobPart]);
  const claude = (window as unknown as { claude?: { use(n: string): Promise<{ save(r: { filename: string; data: Blob }): Promise<unknown> } | null> } }).claude;
  if (claude?.use) {
    const dl = await Promise.race([claude.use('downloads'), new Promise<null>(r => setTimeout(() => r(null), 3000))]);
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); return `Saved ${name}.`; }
      catch (e) { const code = (e as { code?: string }).code; return code === 'declined' ? '' : `Could not save: ${code ?? e}`; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return `Downloaded ${name}.`;
}
