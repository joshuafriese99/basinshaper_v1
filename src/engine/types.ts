/** A point in a projected CRS, metres: [x, y]. */
export type Pt = [number, number];
/** An open ring (first point is not repeated at the end). */
export type Ring = Pt[];

/**
 * Inward distance field of a footprint, sampled at cell centres.
 * `d` holds the distance (m) from each node to the nearest footprint edge,
 * or 0 for nodes outside the footprint.
 */
export interface DistanceField {
  x0: number;
  y0: number;
  /** node spacing, m */
  h: number;
  nx: number;
  ny: number;
  d: Float32Array;
  /** largest inscribed radius, m */
  dmax: number;
  /** index of the node with the largest distance */
  imax: number;
  /** edges as flat [ax, ay, dx, dy, ...] */
  E: Float64Array;
  rings: Ring[];
  /** footprint area, m² */
  area: number;
  /** area centroid, used as the anchor for footprint scaling */
  c: Pt;
  /** principal axis angle, radians */
  axis: number;
}

/** Geometric design parameters of one basin. */
export interface DesignParams {
  /** live storage depth, m (between design water level and bottom / permanent pool) */
  S: number;
  /** freeboard, m (rim to design water level) */
  F: number;
  /** side slope as horizontal : vertical, i.e. 1 : m. 0 = vertical walls */
  m: number;
  /** permanent pool depth, m (wet ponds), default 0 */
  P?: number;
  /** minimum bottom width, m, default 0 */
  minB?: number;
  /** footprint scale factor about the centroid, default 1 */
  s?: number;
}

export interface Evaluation {
  /** total depth rim → bottom, m */
  T: number;
  rimA: number;
  /** design water surface area, m² */
  Awl: number;
  /** flat bottom area, m² */
  Abot: number;
  /** permanent pool surface area, m² */
  Apool: number;
  /** live storage, m³ */
  Vlive: number;
  /** freeboard volume, m³ */
  Vfb: number;
  /** permanent pool (dead) volume, m³ */
  Vdead: number;
  /** total excavation, m³ */
  Vtot: number;
  /** depth at which the bottom closes to a point, m */
  maxT: number;
  /** largest inscribed radius of the (scaled) footprint, m */
  inradius: number;
}

export interface StageRow {
  /** water level above the deepest point, m */
  stage: number;
  depthBelowRim: number;
  /** water surface area, m² */
  area: number;
  /** stored volume, m³ */
  vol: number;
}
