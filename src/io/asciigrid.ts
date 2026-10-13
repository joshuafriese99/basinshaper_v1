/** ESRI ASCII grid (.asc). `data` is row-major, top row first; NaN = NoData. */
export function asciiGrid(nc: number, nr: number, xll: number, yll: number, cs: number, data: ArrayLike<number>, nodata = -9999, dec = 3): string {
  const L = [`ncols ${nc}`, `nrows ${nr}`, `xllcorner ${xll}`, `yllcorner ${yll}`, `cellsize ${cs}`, `NODATA_value ${nodata}`];
  for (let r = 0; r < nr; r++) {
    const row = new Array<string>(nc);
    for (let c = 0; c < nc; c++) {
      const v = data[r * nc + c];
      row[c] = Number.isNaN(v) ? String(nodata) : v === 0 ? '0' : v.toFixed(dec);
    }
    L.push(row.join(' '));
  }
  return L.join('\n') + '\n';
}
