/**
 * Basin design engine: distance field, volumes, solvers, contours.
 *
 * Model: a basin is excavated inside a footprint with constant side slopes 1:m.
 * At a point with inward distance d from the rim, the excavation depth is
 * min(T, d / m), where T = freeboard + live storage + permanent pool.
 * Contours at depth z are therefore iso-lines of the distance field at d = z·m,
 * which is exactly an inward polygon offset (rounded at reflex corners).
 */
import type { DesignParams, DistanceField, Evaluation, Pt, Ring, StageRow } from './types';
import { bbox, centroid, distEdges, edgesOf, netArea, pointIn, principalAxis, ringArea, scaleRings, simplifyRing } from './geometry';

/** Max nodes in a distance field; keeps evaluation fast in the browser. */
const MAX_NODES = 120_000;

/** Build the inward distance field of a footprint (open rings, projected metres). */
export function buildField(rings: Ring[], targetCells = 260): DistanceField {
  const [bx0, by0, bx1, by1] = bbox(rings);
  const W = bx1 - bx0, H = by1 - by0;
  let h = Math.max(W, H) / targetCells;
  if ((W * H) / (h * h) > MAX_NODES) h = Math.sqrt((W * H) / MAX_NODES);
  h = Math.max(h, 0.01);
  const x0 = bx0 - 1.5 * h, y0 = by0 - 1.5 * h;
  const nx = Math.ceil((W + 3 * h) / h) + 1, ny = Math.ceil((H + 3 * h) / h) + 1;
  const d = new Float32Array(nx * ny);
  const E = edgesOf(rings);
  let dmax = 0, imax = 0;
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * h;
    // scanline: even-odd crossings tell which nodes are inside
    const xs: number[] = [];
    for (const r of rings) for (let i = 0, n = r.length, k = n - 1; i < n; k = i++) {
      const a = r[i], b = r[k];
      if ((a[1] > y) !== (b[1] > y)) xs.push((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]);
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - x0) / h));
      const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / h));
      for (let i = i0; i <= i1; i++) {
        const v = distEdges(x0 + i * h, y, E);
        d[j * nx + i] = v;
        if (v > dmax) { dmax = v; imax = j * nx + i; }
      }
    }
  }
  return { x0, y0, h, nx, ny, d, dmax, imax, E, rings, area: Math.abs(netArea(rings)), c: centroid(rings), axis: principalAxis(rings) };
}

export function totalDepth(p: DesignParams): number {
  return p.S + p.F + (p.P ?? 0);
}

/** Excavation depth below rim as a function of inward distance. */
export function depthFn(p: DesignParams): (d: number) => number {
  const T = totalDepth(p), m = p.m;
  return m > 0 ? (d => (d <= 0 ? 0 : Math.min(T, d / m))) : (d => (d > 0 ? T : 0));
}

/** Areas and volumes for a design. */
export function evaluate(f: DistanceField, p: DesignParams): Evaluation {
  const s = p.s ?? 1, T = totalDepth(p), F = p.F, ca = (f.h * s) ** 2;
  const dep = depthFn(p);
  let Vlive = 0, Vfb = 0, Vdead = 0, Awl = 0, Abot = 0, Apool = 0;
  const d = f.d;
  for (let k = 0; k < d.length; k++) {
    const dd = d[k];
    if (dd <= 0) continue;
    const z = dep(dd * s);
    Vfb += Math.min(z, F);
    if (z > F) { Vlive += Math.min(z - F, p.S); Awl++; }
    if (z > F + p.S) { Vdead += z - F - p.S; Apool++; }
    if (z >= T - 1e-9) Abot++;
  }
  return {
    T, rimA: f.area * s * s,
    Awl: Awl * ca, Abot: Abot * ca, Apool: Apool * ca,
    Vlive: Vlive * ca, Vfb: Vfb * ca, Vdead: Vdead * ca, Vtot: (Vlive + Vfb + Vdead) * ca,
    maxT: p.m > 0 ? (f.dmax * s) / p.m : Infinity,
    inradius: f.dmax * s,
  };
}

/** Largest live storage depth that keeps the bottom at least minB wide. */
export function maxStorage(f: DistanceField, p: DesignParams): number {
  if (!(p.m > 0)) return Infinity;
  const s = p.s ?? 1;
  const tb = f.dmax * s - (p.minB ?? 0) / 2;
  return Math.max(0, tb / p.m - p.F - (p.P ?? 0));
}

export interface DepthSolution { S: number; ok: boolean; vmax?: number }
/** Find the storage depth that gives target live volume Vt (footprint fixed). */
export function solveDepth(f: DistanceField, p: DesignParams, Vt: number): DepthSolution {
  const hi = maxStorage(f, p);
  const top = isFinite(hi) ? hi : 50;
  const vmax = evaluate(f, { ...p, S: top }).Vlive;
  if (vmax < Vt) return { S: top, ok: false, vmax };
  let a = 0, b = top;
  for (let i = 0; i < 50; i++) {
    const c = (a + b) / 2;
    if (evaluate(f, { ...p, S: c }).Vlive < Vt) a = c; else b = c;
  }
  return { S: (a + b) / 2, ok: true };
}

export interface ScaleSolution { s: number; ok: boolean; limited?: boolean }
/** Find the footprint scale that gives target live volume Vt (depth fixed). */
export function solveScale(f: DistanceField, p: DesignParams, Vt: number): ScaleSolution {
  const fits = (s: number) => maxStorage(f, { ...p, s }) >= p.S - 1e-9;
  let lo = 0.01;
  while (!fits(lo) && lo < 1000) lo *= 1.5;
  let a = lo, b = Math.max(lo, 1);
  while (evaluate(f, { ...p, s: b }).Vlive < Vt && b < 1e4) b *= 2;
  if (evaluate(f, { ...p, s: a }).Vlive >= Vt) return { s: a, ok: true, limited: true };
  for (let i = 0; i < 60; i++) {
    const c = (a + b) / 2;
    if (evaluate(f, { ...p, s: c }).Vlive < Vt) a = c; else b = c;
  }
  return { s: (a + b) / 2, ok: true };
}

/** Stage–area–volume table from the deepest point up to the rim. */
export function stageStorage(f: DistanceField, p: DesignParams, n = 25): StageRow[] {
  const s = p.s ?? 1, T = totalDepth(p), ca = (f.h * s) ** 2, dep = depthFn(p);
  const z: number[] = [];
  for (const dd of f.d) if (dd > 0) z.push(dep(dd * s));
  const rows: StageRow[] = [];
  for (let k = 0; k <= n; k++) {
    const h = (T * k) / n, lvl = T - h;
    let V = 0, A = 0;
    for (const zz of z) if (zz > lvl) { V += zz - lvl; A++; }
    rows.push({ stage: h, depthBelowRim: lvl, area: A * ca, vol: V * ca });
  }
  return rows;
}

/** Marching squares iso-lines of the distance field at distance tau (unscaled units). */
export function isoRings(f: DistanceField, tau: number): Ring[] {
  const { nx, ny, d, x0, y0, h } = f;
  const NV = nx * ny;
  const segs: [number, number][] = [];
  const at = (i: number, j: number) => d[j * nx + i];
  const Hid = (i: number, j: number) => j * nx + i;
  const Vid = (i: number, j: number) => NV + j * nx + i;
  const pt = (id: number): Pt => {
    if (id < NV) {
      const j = Math.floor(id / nx), i = id % nx;
      const a = at(i, j), b = at(i + 1, j), t = (tau - a) / (b - a);
      return [x0 + (i + t) * h, y0 + j * h];
    }
    const k = id - NV, j = Math.floor(k / nx), i = k % nx;
    const a = at(i, j), b = at(i, j + 1), t = (tau - a) / (b - a);
    return [x0 + i * h, y0 + (j + t) * h];
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = +(at(i, j) >= tau), b = +(at(i + 1, j) >= tau), c = +(at(i + 1, j + 1) >= tau), e = +(at(i, j + 1) >= tau);
    const code = a | (b << 1) | (c << 2) | (e << 3);
    if (code === 0 || code === 15) continue;
    const B = Hid(i, j), T = Hid(i, j + 1), L = Vid(i, j), R = Vid(i + 1, j);
    const ctr = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= tau;
    switch (code) {
      case 1: case 14: segs.push([L, B]); break;
      case 2: case 13: segs.push([B, R]); break;
      case 3: case 12: segs.push([L, R]); break;
      case 4: case 11: segs.push([R, T]); break;
      case 6: case 9: segs.push([B, T]); break;
      case 7: case 8: segs.push([L, T]); break;
      case 5: if (ctr) segs.push([B, R], [T, L]); else segs.push([L, B], [R, T]); break;
      case 10: if (ctr) segs.push([L, B], [R, T]); else segs.push([B, R], [T, L]); break;
    }
  }
  // link segments that share an edge crossing into closed rings
  const byEdge = new Map<number, number[]>();
  segs.forEach((s, k) => { for (const e of s) { const l = byEdge.get(e); if (l) l.push(k); else byEdge.set(e, [k]); } });
  const used = new Uint8Array(segs.length);
  const rings: Ring[] = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const start = segs[k0][0];
    let cur = segs[k0][1];
    const ids = [start];
    let guard = 0;
    while (cur !== start && guard++ < 1e6) {
      ids.push(cur);
      let nk = -1;
      for (const k of byEdge.get(cur)!) if (!used[k]) { nk = k; break; }
      if (nk < 0) break;
      used[nk] = 1;
      cur = segs[nk][0] === cur ? segs[nk][1] : segs[nk][0];
    }
    if (ids.length >= 3) rings.push(simplifyRing(ids.map(pt), h * 0.15));
  }
  return rings.filter(r => Math.abs(ringArea(r)) > h * h * 0.5);
}

/** Outline(s) at depth z below rim, in world coordinates (scale applied). */
export function contourAt(f: DistanceField, p: DesignParams, z: number): Ring[] {
  const s = p.s ?? 1;
  if (z <= 0) return scaleRings(f.rings, f.c, s);
  const tdist = p.m > 0 ? z * p.m : 1e-6;
  return scaleRings(isoRings(f, tdist / s), f.c, s);
}

/** Exact excavation depth at a world point (used for rasters and sections). */
export function depthAtWorld(f: DistanceField, p: DesignParams, x: number, y: number): number {
  const s = p.s ?? 1;
  const ux = f.c[0] + (x - f.c[0]) / s, uy = f.c[1] + (y - f.c[1]) / s;
  if (!pointIn(ux, uy, f.rings)) return 0;
  return depthFn(p)(distEdges(ux, uy, f.E) * s);
}
