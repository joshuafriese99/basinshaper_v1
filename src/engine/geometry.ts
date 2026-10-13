import type { Pt, Ring } from './types';

/** Signed shoelace area (positive = counter-clockwise). */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drop a repeated closing vertex. */
export function openRing(r: Ring): Ring {
  if (r.length > 1) {
    const a = r[0], b = r[r.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return r.slice(0, -1);
  }
  return r.slice();
}

export function closeRing(r: Ring): Ring {
  return [...r, r[0]];
}

export function bbox(rings: Ring[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/** Even-odd point in polygon over all rings (handles holes and multipart). */
export function pointIn(x: number, y: number, rings: Ring[]): boolean {
  let c = false;
  for (const r of rings) {
    for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}

/** Flatten ring edges into [ax, ay, dx, dy, ...]. */
export function edgesOf(rings: Ring[]): Float64Array {
  const E: number[] = [];
  for (const r of rings) for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    E.push(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  return new Float64Array(E);
}

/** Distance from (x, y) to the nearest edge. */
export function distEdges(x: number, y: number, E: Float64Array): number {
  let m = Infinity;
  for (let k = 0; k < E.length; k += 4) {
    const ax = E[k], ay = E[k + 1], dx = E[k + 2], dy = E[k + 3];
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx - x, py = ay + t * dy - y;
    const d = px * px + py * py;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

/** Nesting depth of each ring (0 = outer, 1 = hole, 2 = island in hole …). */
function nesting(rings: Ring[]): number[] {
  return rings.map((r, i) => {
    const p = r[0];
    let depth = 0;
    rings.forEach((o, j) => { if (i !== j && pointIn(p[0], p[1], [o])) depth++; });
    return depth;
  });
}

/** Net area with holes subtracted (even-odd). */
export function netArea(rings: Ring[]): number {
  const depth = nesting(rings);
  return rings.reduce((A, r, i) => A + (depth[i] % 2 ? -1 : 1) * Math.abs(ringArea(r)), 0);
}

/** Area-weighted centroid (even-odd). */
export function centroid(rings: Ring[]): Pt {
  const depth = nesting(rings);
  let cx = 0, cy = 0, A = 0;
  rings.forEach((r, i) => {
    const sgn = (depth[i] % 2 ? -1 : 1) * Math.sign(ringArea(r) || 1);
    for (let k = 0, n = r.length; k < n; k++) {
      const p = r[k], q = r[(k + 1) % n];
      const c = p[0] * q[1] - q[0] * p[1];
      A += sgn * c;
      cx += sgn * (p[0] + q[0]) * c;
      cy += sgn * (p[1] + q[1]) * c;
    }
  });
  A /= 2;
  return A ? [cx / (6 * A), cy / (6 * A)] : [0, 0];
}

/** Chaikin corner cutting on a closed ring. */
export function chaikin(r: Ring, iterations: number): Ring {
  let out = r;
  for (let k = 0; k < iterations; k++) {
    const o: Ring = [];
    for (let i = 0, n = out.length; i < n; i++) {
      const p = out[i], q = out[(i + 1) % n];
      o.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    out = o;
  }
  return out;
}

/** Douglas–Peucker simplification of a closed ring. */
export function simplifyRing(pts: Ring, tol: number): Ring {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s], b = pts[e % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-12;
    let mi = -1, md = tol;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Angle (radians) of the principal axis of the vertices. */
export function principalAxis(rings: Ring[]): number {
  let n = 0, mx = 0, my = 0;
  for (const r of rings) for (const p of r) { mx += p[0]; my += p[1]; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const r of rings) for (const p of r) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Scale rings about centre c by factor s. */
export function scaleRings(rings: Ring[], c: Pt, s: number): Ring[] {
  return rings.map(r => r.map(p => [c[0] + s * (p[0] - c[0]), c[1] + s * (p[1] - c[1])] as Pt));
}

function orient(r: Ring, sign: number): Ring {
  return Math.sign(ringArea(r)) === sign ? r : r.slice().reverse();
}

/**
 * Group rings into polygons (outer ring + holes) by nesting.
 * Outer rings are clockwise and holes counter-clockwise (shapefile convention).
 */
export function toPolygons(rings: Ring[]): Ring[][] {
  const info = rings.map((r, i) => {
    let depth = 0, parent = -1, pa = Infinity;
    rings.forEach((o, j) => {
      if (i !== j && pointIn(r[0][0], r[0][1], [o])) {
        depth++;
        const a = Math.abs(ringArea(o));
        if (a < pa) { pa = a; parent = j; }
      }
    });
    return { depth, parent };
  });
  const polys: Ring[][] = [];
  const idx = new Map<number, number>();
  info.forEach((o, i) => { if (o.depth % 2 === 0) { idx.set(i, polys.length); polys.push([orient(rings[i], -1)]); } });
  info.forEach((o, i) => { if (o.depth % 2 === 1 && idx.has(o.parent)) polys[idx.get(o.parent)!].push(orient(rings[i], 1)); });
  return polys;
}
