/** App state: basins, their design parameters, and solving. */
import {
  buildField, chaikin, contourAt, evaluate, maxStorage, openRing, solveDepth, solveScale,
  type DesignParams, type DistanceField, type Evaluation, type Ring,
} from '../engine';

export type BasinType = 'raingarden' | 'dry' | 'wet';
export type DesignMode = 'depth' | 'vdepth' | 'vsize';

export interface BasinParams {
  type: BasinType;
  mode: DesignMode;
  /** live storage depth, m */
  S: number;
  /** freeboard, m */
  F: number;
  /** permanent pool depth, m (wet ponds) */
  P: number;
  /** side slope 1 : m */
  m: number;
  /** minimum bottom width, m */
  minB: number;
  /** filter media depth, m (rain gardens) */
  media: number;
  /** media porosity, – */
  por: number;
  /** infiltration rate, mm/h */
  inf: number;
  /** target live storage, m³ */
  Vt: number;
  /** footprint scale */
  s: number;
  /** Chaikin smoothing passes */
  smooth: number;
  /** rim elevation, m (null = relative) */
  rimZ: number | null;
  /** contributing catchment area, m² */
  CA: number | null;
  /** runoff coefficient */
  C: number;
  /** design rain, mm */
  rain: number;
}

export interface Result extends Evaluation {
  /** pore storage in filter media, m³ */
  Vmedia: number;
  /** live + media storage, m³ */
  Veff: number;
}

export type FlagLevel = 'ok' | 'warn' | 'bad';

export interface Basin {
  id: number;
  name: string;
  /** source rings as imported (open, projected metres) */
  src: Ring[];
  p: BasinParams;
  fld: DistanceField | null;
  fldKey: string;
  q: DesignParams;
  res: Result;
  flag: { lvl: FlagLevel; msg: string };
  cache: Map<string, Ring[]>;
}

export const PRESET: Record<BasinType, Pick<BasinParams, 'S' | 'F' | 'P' | 'm' | 'minB' | 'media' | 'por' | 'inf'>> = {
  raingarden: { S: 0.2, F: 0.1, P: 0, m: 3, minB: 0.6, media: 0.5, por: 0.3, inf: 30 },
  dry: { S: 1.0, F: 0.3, P: 0, m: 4, minB: 1.0, media: 0, por: 0.3, inf: 5 },
  wet: { S: 0.8, F: 0.3, P: 1.0, m: 5, minB: 2.0, media: 0, por: 0.3, inf: 0 },
};

export const TYPE_LABEL: Record<BasinType, string> = { raingarden: 'Rain garden', dry: 'Dry basin', wet: 'Wet pond' };

export function newParams(type: BasinType = 'raingarden'): BasinParams {
  return { type, mode: 'depth', ...PRESET[type], Vt: 20, s: 1, smooth: 0, rimZ: null, CA: null, C: 0.9, rain: 20 };
}

export const state = {
  basins: [] as Basin[],
  sel: -1,
  crs: 'EPSG:25832',
  srcPrj: null as string | null,
  example: true,
  secRot: false,
  view: null as { cx: number; cy: number; k: number } | null,
  uid: 1,
};

export const fmt = (v: number | null | undefined, d = 2): string =>
  v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

export function makeBasin(name: string, rings: Ring[], p?: BasinParams): Basin {
  const b = {
    id: state.uid++, name,
    src: rings.map(openRing).filter(r => r.length >= 3),
    p: p ?? newParams(), fld: null, fldKey: '', cache: new Map(),
  } as unknown as Basin;
  return solve(b);
}

/** Footprint rings after optional smoothing (unscaled). */
export function ringsOf(b: Basin): Ring[] {
  const k = b.p.smooth | 0;
  return k > 0 ? b.src.map(r => chaikin(r, Math.min(k, 4))) : b.src;
}

export function field(b: Basin): DistanceField {
  const key = String(b.p.smooth | 0);
  if (!b.fld || b.fldKey !== key) { b.fld = buildField(ringsOf(b)); b.fldKey = key; }
  return b.fld;
}

export function designParams(b: Basin): DesignParams {
  const p = b.p;
  return { S: p.S, F: p.F, P: p.type === 'wet' ? p.P : 0, m: p.m, minB: p.minB, s: p.s };
}

/** Apply the design mode, evaluate and set a status flag. */
export function solve(b: Basin): Basin {
  const fld = field(b), P = b.p, q = designParams(b);
  let flag: Basin['flag'] | null = null;
  if (P.mode === 'vdepth') {
    const r = solveDepth(fld, q, P.Vt);
    P.S = q.S = r.S;
    if (!r.ok) flag = { lvl: 'bad', msg: `Target not reachable with this footprint. Max storage is ${fmt(r.vmax, 1)} m³ before the bottom gets narrower than ${fmt(P.minB, 1)} m. Increase the footprint, steepen the slopes or use "Set volume → size".` };
  } else if (P.mode === 'vsize') {
    const r = solveScale(fld, q, P.Vt);
    P.s = q.s = r.s;
    if (r.limited) flag = { lvl: 'warn', msg: 'Footprint is held at the smallest size that still fits the storage depth and minimum bottom width; volume exceeds the target.' };
  }
  const ms = maxStorage(fld, q);
  if (!flag && q.S > ms + 1e-6) flag = { lvl: 'bad', msg: `Storage depth ${fmt(q.S)} m does not fit: with slope 1:${fmt(q.m, 1)} the bottom closes at ${fmt(Math.max(0, ms))} m storage depth (min. bottom width ${fmt(q.minB, 1)} m). Reduce the depth, steepen the slopes or enlarge the footprint.` };
  const ev = evaluate(fld, q);
  const Vmedia = P.type === 'raingarden' ? ev.Abot * (P.media || 0) * (P.por || 0) : 0;
  b.res = { ...ev, Vmedia, Veff: ev.Vlive + Vmedia };
  b.q = q;
  b.cache = new Map();
  if (P.mode !== 'depth' && !flag && Math.abs(b.res.Vlive - P.Vt) > Math.max(0.05, P.Vt * 0.002)) flag = { lvl: 'warn', msg: 'Solver did not converge exactly.' };
  b.flag = flag ?? { lvl: 'ok', msg: 'Geometry fits.' };
  return b;
}

/** Cached outline at depth z below rim (world coordinates). */
export function outline(b: Basin, z: number): Ring[] {
  const k = z.toFixed(5);
  let r = b.cache.get(k);
  if (!r) { r = contourAt(field(b), b.q, z); b.cache.set(k, r); }
  return r;
}

export const current = (): Basin | undefined => state.basins[state.sel];
export const hasRim = (b: Basin): b is Basin & { p: { rimZ: number } } => b.p.rimZ != null;
