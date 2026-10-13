/** Example basins near Valby, Copenhagen (EPSG:25832) shown on first load. */
import type { Pt } from '../engine';
import { makeBasin, newParams, type Basin } from './model';

export function exampleBasins(): Basin[] {
  const cx = 720540, cy = 6173460;
  // curved street-side rain garden strip
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = -0.5 + t;
    const x = cx - 45 + 60 * Math.sin(a), y = cy + 25 + 60 * (1 - Math.cos(a)) * 0.6;
    const tx = Math.cos(a), ty = Math.sin(a) * 1.2, L = Math.hypot(tx, ty);
    const ox = -ty / L, oy = tx / L, w = 1.9 + 0.5 * Math.sin(t * Math.PI);
    left.push([x + ox * w, y + oy * w]);
    right.push([x - ox * w, y - oy * w]);
  }
  // irregular park basin
  const blob: Pt[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 2 * Math.PI, r = 13 + 3 * Math.sin(2 * a + 0.6) + 1.6 * Math.cos(3 * a);
    blob.push([cx + 18 + 1.45 * r * Math.cos(a), cy - 18 + r * Math.sin(a)]);
  }
  const p1 = { ...newParams('raingarden'), CA: 600, C: 0.9, rain: 20 };
  const p2 = { ...newParams('dry'), mode: 'vdepth' as const, Vt: 270, smooth: 1, rimZ: 21.5, CA: 9000, C: 0.6, rain: 50 };
  return [
    makeBasin('Example rain garden – street', [[...left, ...right.reverse()]], p1),
    makeBasin('Example retention basin – park', [blob], p2),
  ];
}
