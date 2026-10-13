import type { Pt } from './types';

/**
 * Transverse Mercator forward projection (Snyder 1987, eq. 8-9 ff.),
 * accurate to centimetres within a UTM zone. Defaults are GRS80 / UTM.
 */
export function tmForward(lon: number, lat: number, lon0: number, k0 = 0.9996, fe = 500000, a = 6378137, invf = 298.257222101): Pt {
  const f = 1 / invf, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
  const ph = lat * r, s = Math.sin(ph), c = Math.cos(ph), t = Math.tan(ph);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lon - lon0) * r;
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * ph
    - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * ph)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * ph)
    - ((35 * e6) / 3072) * Math.sin(6 * ph));
  const x = fe + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y = k0 * (M + N * t * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [x, y];
}
