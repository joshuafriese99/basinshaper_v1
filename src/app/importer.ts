/** Import footprints from shapefiles (loose or zipped) and GeoJSON. */
import { bbox, tmForward, type Pt, type Ring } from '../engine';
import { unzip } from '../io/zip';
import { readDbf, readShp, type DbfRow } from '../io/shapefile';
import { CRS_LIST, projcsName } from '../io/crs';
import { makeBasin, newParams, state, type BasinParams, type BasinType } from './model';

interface Imported { rings: Ring[]; attrs: DbfRow; name: string }

export interface ImportResult { count: number; note: string; errors: string[] }

export async function importFiles(list: File[]): Promise<ImportResult> {
  const files: Record<string, Uint8Array> = {};
  for (const f of list) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      const z = await unzip(await f.arrayBuffer());
      for (const [k, v] of Object.entries(z)) if (!k.startsWith('__MACOSX')) files[k.split('/').pop()!] = v;
    } else files[f.name] = new Uint8Array(await f.arrayBuffer());
  }
  const names = Object.keys(files);
  const out: Imported[] = [];
  const errors: string[] = [];
  let prj: string | null = null;

  for (const n of names.filter(n => /\.shp$/i.test(n))) {
    const base = n.slice(0, -4);
    const get = (ext: string) => files[names.find(k => k.toLowerCase() === (base + ext).toLowerCase()) ?? ''];
    const shp = readShp(files[n]);
    const rows = readDbf(get('.dbf'));
    const p = get('.prj');
    if (p) prj = new TextDecoder().decode(p);
    if (![5, 15, 25].includes(shp.type)) { errors.push(`${n}: not a polygon shapefile (type ${shp.type}).`); continue; }
    shp.recs.forEach((r, i) => { if (r) out.push({ rings: r.rings, attrs: rows[i] ?? {}, name: nameFrom(rows[i], `${base} #${i + 1}`) }); });
  }

  for (const n of names.filter(n => /\.(geo)?json$/i.test(n))) {
    const gj = JSON.parse(new TextDecoder().decode(files[n]));
    const feats: { geometry: { type: string; coordinates: unknown } | null; properties?: DbfRow }[] =
      gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj, properties: {} }];
    const crsName: string = gj.crs?.properties?.name ?? '';
    const m = crsName.match(/EPSG:{1,2}(\d+)/i);
    if (m && CRS_LIST.some(c => c.id === 'EPSG:' + m[1])) state.crs = 'EPSG:' + m[1];
    feats.forEach((ft, i) => {
      const g = ft.geometry;
      if (!g) return;
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pt[][][];
      const rings = polys.flat();
      if (rings.length) out.push({ rings, attrs: ft.properties ?? {}, name: nameFrom(ft.properties, `${n.replace(/\.(geo)?json$/i, '')} #${i + 1}`) });
    });
    if (!m) prj = prj ?? 'GEOGCS'; // RFC 7946: WGS84 lon/lat
  }

  if (!out.length) return { count: 0, note: '', errors: [...errors, 'No polygons found. Import a polygon shapefile (all parts or zipped) or a GeoJSON file.'] };

  const [x0, y0, x1, y1] = bbox(out.flatMap(o => o.rings));
  const geographic = x0 >= -180 && x1 <= 180 && y0 >= -90 && y1 <= 90 && (!prj || !/PROJCS/i.test(prj));
  let note: string;
  if (geographic) {
    let c = CRS_LIST.find(c => c.id === state.crs);
    if (!c?.lon0) { state.crs = 'EPSG:25832'; c = CRS_LIST[0]; }
    const lon0 = c.lon0!;
    out.forEach(o => { o.rings = o.rings.map(r => r.map(p => tmForward(p[0], p[1], lon0))); });
    note = `Input was in longitude/latitude. Reprojected to ${c.id}.`;
    state.srcPrj = null;
  } else if (prj && /PROJCS/i.test(prj)) {
    state.srcPrj = prj;
    const name = projcsName(prj);
    const known = CRS_LIST.find(c => c.wkt && name && projcsName(c.wkt) === name);
    state.crs = known ? known.id : 'src';
    note = `Coordinates kept as imported (${name ?? 'projected'}).`;
  } else note = 'No .prj found. Pick the CRS of your data so exports get the right .prj.';

  if (state.example) { state.basins = []; state.example = false; }
  const first = state.basins.length;
  for (const o of out) {
    const p = newParams(guessType(o.attrs));
    applyAttrs(p, o.attrs);
    const b = makeBasin(o.name, o.rings, p);
    if (b.src.length) state.basins.push(b);
  }
  state.sel = first;
  return { count: out.length, note, errors };
}

function nameFrom(a: DbfRow | undefined, fallback: string): string {
  if (!a) return fallback;
  for (const k of Object.keys(a)) if (/^(name|namn|bezeichn|label|id)$/i.test(k) && String(a[k]).trim()) return String(a[k]).trim();
  return fallback;
}

function guessType(a: DbfRow): BasinType {
  const t = Object.entries(a).find(([k]) => /^type$/i.test(k));
  if (!t) return 'raingarden';
  const v = String(t[1]).toLowerCase();
  return /wet|pond|damm|teich|sø/.test(v) ? 'wet' : /dry|basin|retention|becken|bassin/.test(v) ? 'dry' : 'raingarden';
}

/** Read design values from attribute fields with recognised names. */
function applyAttrs(p: BasinParams, a: DbfRow): void {
  const map: [keyof BasinParams, RegExp][] = [
    ['S', /^(depth|depth_m|stor_depth|s_m)$/i], ['F', /^(freeboard|fb|f_m)$/i], ['m', /^(slope|side_slope)$/i],
    ['Vt', /^(volume|vol_m3|target_vol|v_target)$/i], ['rimZ', /^(rim_z|rim_elev|rim)$/i], ['CA', /^(catch_m2|catchment)$/i],
  ];
  for (const [k, v] of Object.entries(a)) for (const [pk, re] of map) {
    if (re.test(k) && v !== '' && v !== null && isFinite(Number(v))) {
      (p as unknown as Record<string, number>)[pk] = Number(v);
      if (pk === 'Vt') p.mode = 'vdepth';
    }
  }
}
