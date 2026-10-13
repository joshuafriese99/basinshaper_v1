/** ESRI shapefile (.shp/.shx) and dBASE (.dbf) read/write, polygons and polylines. */
import type { Ring } from '../engine/types';
import { bbox } from '../engine/geometry';
import { concat } from './zip';

export const SHP_POLYLINE = 3;
export const SHP_POLYGON = 5;

export interface ShpRecord { rings: Ring[]; shpType: number }
export interface ShpFile { type: number; recs: (ShpRecord | null)[] }

/** Read polygon / polyline records (Z and M variants are read as 2D). */
export function readShp(u8: Uint8Array): ShpFile {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const type = dv.getInt32(32, true);
  const recs: (ShpRecord | null)[] = [];
  let p = 100;
  while (p + 8 <= u8.length) {
    const len = dv.getInt32(p + 4, false) * 2;
    const t = dv.getInt32(p + 8, true);
    const q = p + 8;
    if ([3, 5, 13, 15, 23, 25].includes(t)) {
      const np = dv.getInt32(q + 36, true), npt = dv.getInt32(q + 40, true);
      const starts: number[] = [];
      for (let i = 0; i < np; i++) starts.push(dv.getInt32(q + 44 + 4 * i, true));
      const pb = q + 44 + 4 * np;
      const pts: Ring = [];
      for (let i = 0; i < npt; i++) pts.push([dv.getFloat64(pb + 16 * i, true), dv.getFloat64(pb + 16 * i + 8, true)]);
      recs.push({ rings: starts.map((s, i) => pts.slice(s, i + 1 < np ? starts[i + 1] : npt)), shpType: t });
    } else recs.push(null);
    p = q + len;
  }
  return { type, recs };
}

export type DbfValue = string | number | null;
export type DbfRow = Record<string, DbfValue>;

export function readDbf(u8: Uint8Array | undefined): DbfRow[] {
  if (!u8) return [];
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
  const fields: { name: string; type: string; len: number }[] = [];
  const td = new TextDecoder('utf-8');
  let p = 32;
  while (u8[p] !== 0x0d && p < hl) {
    const name = td.decode(u8.subarray(p, p + 11)).replace(/\0[\s\S]*$/, '').trim();
    fields.push({ name, type: String.fromCharCode(u8[p + 11]), len: u8[p + 16] });
    p += 32;
  }
  const rows: DbfRow[] = [];
  for (let r = 0; r < n; r++) {
    let q = hl + r * rl + 1;
    const o: DbfRow = {};
    for (const f of fields) {
      const v = td.decode(u8.subarray(q, q + f.len)).trim();
      o[f.name] = (f.type === 'N' || f.type === 'F') && v !== '' ? Number(v) : v;
      q += f.len;
    }
    rows.push(o);
  }
  return rows;
}

export interface ShpFeature { parts: Ring[] }

/** Write .shp + .shx. Rings in `parts` must be closed (first point repeated). */
export function writeShp(feats: ShpFeature[], shpType: number): { shp: Uint8Array; shx: Uint8Array } {
  const recs = feats.map(f => {
    const pts = f.parts.flat();
    const np = f.parts.length, n = pts.length;
    const b = new DataView(new ArrayBuffer(44 + 4 * np + 16 * n));
    const [x0, y0, x1, y1] = bbox(f.parts);
    b.setInt32(0, shpType, true);
    b.setFloat64(4, x0, true); b.setFloat64(12, y0, true); b.setFloat64(20, x1, true); b.setFloat64(28, y1, true);
    b.setInt32(36, np, true); b.setInt32(40, n, true);
    let s = 0;
    f.parts.forEach((part, i) => { b.setInt32(44 + 4 * i, s, true); s += part.length; });
    pts.forEach((p, i) => { b.setFloat64(44 + 4 * np + 16 * i, p[0], true); b.setFloat64(52 + 4 * np + 16 * i, p[1], true); });
    return new Uint8Array(b.buffer);
  });
  const all = feats.flatMap(f => f.parts);
  const bb = all.length ? bbox(all) : [0, 0, 0, 0];
  const header = (lenBytes: number) => {
    const h = new DataView(new ArrayBuffer(100));
    h.setInt32(0, 9994, false); h.setInt32(24, lenBytes / 2, false); h.setInt32(28, 1000, true); h.setInt32(32, shpType, true);
    bb.forEach((v, i) => h.setFloat64(36 + 8 * i, v, true));
    return new Uint8Array(h.buffer);
  };
  const shpParts: Uint8Array[] = [], shxParts: Uint8Array[] = [];
  let off = 100;
  recs.forEach((r, i) => {
    const rh = new DataView(new ArrayBuffer(8));
    rh.setInt32(0, i + 1, false); rh.setInt32(4, r.length / 2, false);
    shpParts.push(new Uint8Array(rh.buffer), r);
    const xr = new DataView(new ArrayBuffer(8));
    xr.setInt32(0, off / 2, false); xr.setInt32(4, r.length / 2, false);
    shxParts.push(new Uint8Array(xr.buffer));
    off += 8 + r.length;
  });
  return { shp: concat([header(off), ...shpParts]), shx: concat([header(100 + 8 * recs.length), ...shxParts]) };
}

export interface DbfField { name: string; type: 'C' | 'N'; len: number; dec?: number }

export function writeDbf(fields: DbfField[], rows: Record<string, unknown>[]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const hl = 32 + 32 * fields.length + 1;
  const rl = 1 + fields.reduce((a, f) => a + f.len, 0);
  const b = new Uint8Array(hl + rl * rows.length + 1);
  const dv = new DataView(b.buffer);
  const d = new Date();
  b[0] = 3; b[1] = d.getFullYear() - 1900; b[2] = d.getMonth() + 1; b[3] = d.getDate();
  dv.setUint32(4, rows.length, true); dv.setUint16(8, hl, true); dv.setUint16(10, rl, true);
  fields.forEach((f, i) => {
    const o = 32 + 32 * i;
    b.set(enc(f.name.slice(0, 10)), o);
    b[o + 11] = f.type.charCodeAt(0); b[o + 16] = f.len; b[o + 17] = f.dec ?? 0;
  });
  b[hl - 1] = 0x0d;
  rows.forEach((r, k) => {
    let o = hl + k * rl;
    b[o++] = 0x20;
    for (const f of fields) {
      const v = r[f.name];
      b.fill(0x20, o, o + f.len);
      if (f.type === 'N') {
        const num = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v);
        const s = isFinite(num) ? num.toFixed(f.dec ?? 0).padStart(f.len).slice(-f.len) : '';
        b.set(enc(s), o);
      } else {
        let u = enc(String(v ?? ''));
        if (u.length > f.len) u = u.subarray(0, f.len);
        b.set(u, o);
      }
      o += f.len;
    }
  });
  b[b.length - 1] = 0x1a;
  return b;
}
