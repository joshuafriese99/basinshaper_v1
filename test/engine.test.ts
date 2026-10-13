import { describe, expect, it } from 'vitest';
import {
  buildField, contourAt, depthAtWorld, evaluate, isoRings, ringArea, solveDepth, solveScale, stageStorage, tmForward, toPolygons,
  type Ring,
} from '../src/engine';
import { readDbf, readShp, writeDbf, writeShp } from '../src/io/shapefile';
import { crc32 } from '../src/io/zip';

const rect: Ring = [[0, 0], [20, 0], [20, 10], [0, 10]];

describe('volumes', () => {
  const f = buildField([rect]);

  it('matches the prismoidal formula for a rectangular basin', () => {
    // 20×10 m top, slope 1:2, depth 0.5 m → bottom 18×8, mid 19×9
    const V = (0.5 / 6) * (200 + 4 * 171 + 144);
    const e = evaluate(f, { S: 0.5, F: 0, m: 2 });
    expect(e.Vlive).toBeCloseTo(V, 1);
    expect(e.Abot).toBeCloseTo(144, 0);
    expect(e.rimA).toBe(200);
  });

  it('solves depth for a target volume', () => {
    const p = { S: 0, F: 0.1, m: 2 };
    const r = solveDepth(f, p, 50);
    expect(r.ok).toBe(true);
    expect(evaluate(f, { ...p, S: r.S }).Vlive).toBeCloseTo(50, 2);
  });

  it('solves footprint scale for a target volume', () => {
    const p = { S: 0.5, F: 0, m: 2 };
    const r = solveScale(f, p, 300);
    expect(evaluate(f, { ...p, s: r.s }).Vlive).toBeCloseTo(300, 2);
  });

  it('reports the volume at full stage in the stage–storage table', () => {
    const rows = stageStorage(f, { S: 0.5, F: 0, m: 2 }, 10);
    expect(rows[0].vol).toBe(0);
    expect(rows[10].vol).toBeCloseTo(evaluate(f, { S: 0.5, F: 0, m: 2 }).Vlive, 3);
  });
});

describe('contours', () => {
  it('insets a rectangle exactly', () => {
    const r = isoRings(buildField([rect]), 1);
    expect(r).toHaveLength(1);
    expect(Math.abs(ringArea(r[0]))).toBeCloseTo(144, 1);
  });

  it('keeps holes as holes', () => {
    const L: Ring = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
    const hole: Ring = [[3, 3], [6, 3], [6, 6], [3, 6]];
    const polys = toPolygons(contourAt(buildField([L, hole]), { S: 1, F: 0, m: 1 }, 1));
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(2);
    expect(ringArea(polys[0][0])).toBeLessThan(0); // outer clockwise
    expect(ringArea(polys[0][1])).toBeGreaterThan(0); // hole counter-clockwise
  });

  it('gives exact depth at points', () => {
    const f = buildField([rect]);
    expect(depthAtWorld(f, { S: 0.5, F: 0, m: 2 }, 10, 5)).toBe(0.5);
    expect(depthAtWorld(f, { S: 0.5, F: 0, m: 2 }, 0.5, 5)).toBeCloseTo(0.25, 6);
    expect(depthAtWorld(f, { S: 0.5, F: 0, m: 2 }, -1, 5)).toBe(0);
  });
});

describe('io', () => {
  it('round-trips a shapefile and dbf', () => {
    const ring: Ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const w = writeShp([{ parts: [ring] }], 5);
    const back = readShp(w.shp);
    expect(back.type).toBe(5);
    expect(back.recs[0]?.rings[0]).toEqual(ring);
    const dbf = writeDbf([{ name: 'name', type: 'C', len: 20 }, { name: 'vol', type: 'N', len: 10, dec: 1 }], [{ name: 'Bäcken', vol: 12.34 }]);
    expect(readDbf(dbf)).toEqual([{ name: 'Bäcken', vol: 12.3 }]);
  });

  it('computes standard CRC32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('projects lon/lat to UTM 32N', () => {
    // Valby, Copenhagen: regression value for 12.51 E 55.66 N
    const [x, y] = tmForward(12.51, 55.66, 9);
    expect(x).toBeCloseTo(720778.8, 0);
    expect(y).toBeCloseTo(6173826.3, 0);
  });
});
