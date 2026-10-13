/** Canvas drawing: plan view, cross-section, stage–storage curve. */
import { bbox, depthAtWorld, scaleRings, stageStorage, type Pt, type Ring } from '../engine';
import { current, field, fmt, outline, ringsOf, state, type Basin } from './model';

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function setupCanvas(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function hex(c: string): number[] {
  c = c.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
}
function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
export const niceStep = (span: number, n: number): number => {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) ?? raw;
};

export const worldRim = (b: Basin): Ring[] => scaleRings(ringsOf(b), field(b).c, b.p.s);

// ---------- plan ----------
export function fitView(plan: HTMLCanvasElement): void {
  const all = state.basins.flatMap(worldRim);
  if (!all.length) return;
  const [x0, y0, x1, y1] = bbox(all), r = plan.getBoundingClientRect(), pad = 40;
  const k = Math.min((r.width - 2 * pad) / Math.max(1, x1 - x0), (r.height - 2 * pad) / Math.max(1, y1 - y0));
  state.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.max(0.05, k) };
}

export function screenToWorld(plan: HTMLCanvasElement, clientX: number, clientY: number): Pt | null {
  const v = state.view;
  if (!v) return null;
  const r = plan.getBoundingClientRect();
  return [v.cx + (clientX - r.left - r.width / 2) / v.k, v.cy - (clientY - r.top - r.height / 2) / v.k];
}

function pathRings(g: CanvasRenderingContext2D, rings: Ring[], T: (p: Pt) => Pt): void {
  g.beginPath();
  for (const r of rings) {
    r.forEach((p, i) => { const q = T(p); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
    g.closePath();
  }
}

export function drawPlan(plan: HTMLCanvasElement, contourInterval: number): void {
  const { g, w, h } = setupCanvas(plan);
  if (!state.view) fitView(plan);
  const v = state.view;
  if (!v) { g.fillStyle = css('--muted'); g.font = `14px ${css('--f-body')}`; g.fillText('Import an outline to start.', 20, 30); return; }
  const T = (p: Pt): Pt => [w / 2 + (p[0] - v.cx) * v.k, h / 2 - (p[1] - v.cy) * v.k];
  const ink = css('--ink'), muted = css('--muted'), line = css('--line'), water = css('--water'), pool = css('--pool');
  const earth = css('--earth'), veg = css('--veg'), panel = css('--panel'), accent = css('--accent'), soft = css('--soft');

  // coordinate grid
  const step = niceStep(w / v.k, 6);
  g.strokeStyle = line; g.lineWidth = 1; g.fillStyle = muted; g.font = `10px ${css('--f-mono')}`;
  const xs = v.cx - w / 2 / v.k, ys = v.cy - h / 2 / v.k;
  for (let x = Math.ceil(xs / step) * step; x < xs + w / v.k; x += step) {
    const sx = T([x, 0])[0];
    g.globalAlpha = 0.55; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, h); g.stroke(); g.globalAlpha = 1;
    g.fillText(String(Math.round(x)), sx + 3, h - 6);
  }
  for (let y = Math.ceil(ys / step) * step; y < ys + h / v.k; y += step) {
    const sy = T([0, y])[1];
    g.globalAlpha = 0.55; g.beginPath(); g.moveTo(0, sy); g.lineTo(w, sy); g.stroke(); g.globalAlpha = 1;
    g.fillText(String(Math.round(y)), 4, sy - 3);
  }

  state.basins.forEach((b, i) => {
    const sel = i === state.sel, rim = worldRim(b), T0 = b.res.T;
    // depth bands
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const rings = k === 0 ? rim : outline(b, (T0 * k) / n);
      if (!rings.length) break;
      g.fillStyle = mix(soft, b.p.type === 'raingarden' ? veg : earth, 0.25 + 0.55 * (k / n));
      g.globalAlpha = sel ? 1 : 0.55;
      pathRings(g, rings, T); g.fill('evenodd');
    }
    const wl = outline(b, b.p.F);
    g.globalAlpha = sel ? 0.55 : 0.3;
    if (wl.length) { g.fillStyle = water; pathRings(g, wl, T); g.fill('evenodd'); }
    if (b.p.type === 'wet') { const pl = outline(b, b.p.F + b.p.S); if (pl.length) { g.fillStyle = pool; pathRings(g, pl, T); g.fill('evenodd'); } }
    g.globalAlpha = 1;
    if (sel) {
      const ci = Math.max(0.01, contourInterval), nC = Math.floor(T0 / ci + 1e-6);
      g.strokeStyle = ink; g.lineWidth = 0.6; g.globalAlpha = 0.45;
      if (nC <= 60) for (let k = 1; k <= nC; k++) { pathRings(g, outline(b, k * ci), T); g.stroke(); }
      g.globalAlpha = 1;
      if (wl.length) { g.setLineDash([5, 4]); g.strokeStyle = water; g.lineWidth = 1.5; pathRings(g, wl, T); g.stroke(); g.setLineDash([]); }
      const bot = outline(b, T0 - 1e-6);
      if (bot.length) { g.strokeStyle = ink; g.lineWidth = 1.2; pathRings(g, bot, T); g.stroke(); }
    }
    g.strokeStyle = sel ? accent : ink; g.lineWidth = sel ? 2.2 : 1.1;
    pathRings(g, rim, T); g.stroke();
    if (sel) {
      const [A, B] = sectionLine(b), a = T(A), c = T(B);
      g.strokeStyle = accent; g.setLineDash([2, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); g.setLineDash([]);
      g.fillStyle = accent; g.font = `600 11px ${css('--f-body')}`;
      g.fillText('A', a[0] - 10, a[1] + 4); g.fillText('A′', c[0] + 4, c[1] + 4);
    }
    // label
    const c = T(field(b).c);
    g.font = `${sel ? 600 : 500} 11px ${css('--f-body')}`;
    const lbl = b.name.length > 28 ? b.name.slice(0, 27) + '…' : b.name, tw = g.measureText(lbl).width;
    g.fillStyle = panel; g.globalAlpha = 0.8; g.fillRect(c[0] - tw / 2 - 3, c[1] - 9, tw + 6, 14);
    g.globalAlpha = sel ? 1 : 0.7; g.fillStyle = ink; g.fillText(lbl, c[0] - tw / 2, c[1] + 2); g.globalAlpha = 1;
  });

  // scale bar
  const sb = niceStep(w / v.k, 5), px = sb * v.k;
  g.fillStyle = panel; g.globalAlpha = 0.85; g.fillRect(w - px - 26, 10, px + 16, 26); g.globalAlpha = 1;
  g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(w - px - 18, 28); g.lineTo(w - 18, 28); g.stroke();
  g.fillStyle = ink; g.font = `11px ${css('--f-mono')}`; g.fillText(`${sb} m`, w - px - 18, 22);
}

// ---------- section ----------
/** Section line through the deepest point, along the principal axis (or across it). */
export function sectionLine(b: Basin): [Pt, Pt] {
  const fld = field(b), s = b.p.s, a = fld.axis + (state.secRot ? Math.PI / 2 : 0);
  const c0: Pt = [fld.x0 + (fld.imax % fld.nx) * fld.h, fld.y0 + Math.floor(fld.imax / fld.nx) * fld.h];
  const c: Pt = [fld.c[0] + s * (c0[0] - fld.c[0]), fld.c[1] + s * (c0[1] - fld.c[1])];
  const dx = Math.cos(a), dy = Math.sin(a);
  let lo = Infinity, hi = -Infinity;
  for (const r of worldRim(b)) for (const p of r) {
    const t = (p[0] - c[0]) * dx + (p[1] - c[1]) * dy;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  const m = (hi - lo) * 0.08 + 1;
  return [[c[0] + (lo - m) * dx, c[1] + (lo - m) * dy], [c[0] + (hi + m) * dx, c[1] + (hi + m) * dy]];
}

export function drawSection(cv: HTMLCanvasElement, info: HTMLElement): void {
  const { g, w, h } = setupCanvas(cv), b = current();
  if (!b) { info.textContent = ''; return; }
  const [A, B] = sectionLine(b), L = Math.hypot(B[0] - A[0], B[1] - A[1]), N = 260, fld = field(b);
  const pr: [number, number][] = [];
  for (let i = 0; i <= N; i++) { const t = i / N; pr.push([t * L, depthAtWorld(fld, b.q, A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]))]); }
  const P = b.p, T0 = b.res.T, media = P.type === 'raingarden' ? P.media || 0 : 0;
  const zmin = -(T0 + media) * 1.15 - 0.05, zmax = Math.max(0.1, T0 * 0.25);
  const ml = 46, mr = 12, mt = 12, mb = 22;
  const X = (x: number) => ml + (x / L) * (w - ml - mr), Y = (z: number) => mt + ((zmax - z) / (zmax - zmin)) * (h - mt - mb);
  const ve = ((h - mt - mb) / (zmax - zmin)) / ((w - ml - mr) / L);
  info.textContent = `A–A′ ${fmt(L, 1)} m · vertical ×${fmt(ve, ve < 10 ? 1 : 0)}`;
  const ink = css('--ink'), muted = css('--muted'), line = css('--line'), water = css('--water'), pool = css('--pool'), earth = css('--earth'), veg = css('--veg');

  g.font = `10px ${css('--f-mono')}`; g.fillStyle = muted; g.strokeStyle = line; g.lineWidth = 1;
  const zs = niceStep(zmax - zmin, 4);
  for (let z = Math.ceil(zmin / zs) * zs; z <= zmax + 1e-9; z += zs) {
    g.globalAlpha = 0.6; g.beginPath(); g.moveTo(ml, Y(z)); g.lineTo(w - mr, Y(z)); g.stroke(); g.globalAlpha = 1;
    g.fillText(P.rimZ != null ? (P.rimZ + z).toFixed(2) : z.toFixed(2), 2, Y(z) + 3);
  }
  // soil body
  g.beginPath(); g.moveTo(X(0), Y(0));
  pr.forEach(([x, d]) => g.lineTo(X(x), Y(-d)));
  g.lineTo(X(L), Y(0)); g.lineTo(X(L), h - mb); g.lineTo(X(0), h - mb); g.closePath();
  g.fillStyle = mix('#ffffff', earth, 0.35); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
  // filter media
  if (media > 0) {
    g.beginPath();
    pr.forEach(([x, d], i) => { const yy = Y(-d - (d > 0 ? media : 0)); if (i) g.lineTo(X(x), yy); else g.moveTo(X(x), yy); });
    for (let i = pr.length - 1; i >= 0; i--) g.lineTo(X(pr[i][0]), Y(-pr[i][1]));
    g.closePath(); g.fillStyle = veg; g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
  }
  // water bodies, drawn per contiguous wet run
  const fillWater = (lvl: number, col: string, alpha: number, floor: number | null) => {
    g.fillStyle = col; g.globalAlpha = alpha;
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        g.beginPath();
        run.forEach(([x], i) => { if (i) g.lineTo(X(x), Y(-lvl)); else g.moveTo(X(x), Y(-lvl)); });
        for (let i = run.length - 1; i >= 0; i--) { const [x, d] = run[i]; g.lineTo(X(x), Y(-(floor != null ? Math.min(d, floor) : d))); }
        g.closePath(); g.fill();
      }
      run = [];
    };
    pr.forEach(pt => { if (pt[1] > lvl + 1e-9) run.push(pt); else flush(); });
    flush(); g.globalAlpha = 1;
  };
  fillWater(P.F, water, 0.45, P.type === 'wet' ? P.F + P.S : null);
  if (P.type === 'wet') fillWater(P.F + P.S, pool, 0.55, null);
  // ground line
  g.strokeStyle = ink; g.lineWidth = 1.6; g.beginPath();
  pr.forEach(([x, d], i) => { if (i) g.lineTo(X(x), Y(-d)); else g.moveTo(X(x), Y(-d)); });
  g.stroke();
  g.setLineDash([4, 3]); g.strokeStyle = water; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(ml, Y(-P.F)); g.lineTo(w - mr, Y(-P.F)); g.stroke(); g.setLineDash([]);
  g.fillStyle = ink; g.font = `600 10px ${css('--f-body')}`;
  g.fillText('A', ml + 2, h - 8); g.fillText('A′', w - mr - 12, h - 8);
  g.fillStyle = water; g.fillText(`design WL −${fmt(P.F)} m`, w - mr - 110, Y(-P.F) - 4);
  g.fillStyle = muted; g.font = `10px ${css('--f-body')}`; g.fillText(`slope 1:${fmt(P.m, 1)}`, ml + 6, Y(0) - 4);
}

// ---------- stage–storage ----------
export function drawStage(cv: HTMLCanvasElement, info: HTMLElement): void {
  const { g, w, h } = setupCanvas(cv), b = current();
  if (!b) { info.textContent = ''; return; }
  const rows = stageStorage(field(b), b.q, 40);
  const Vmax = rows[rows.length - 1].vol || 1, T0 = b.res.T;
  const ml = 46, mr = 12, mt = 10, mb = 26;
  const X = (v: number) => ml + (v / Vmax) * (w - ml - mr), Y = (s: number) => mt + (1 - s / T0) * (h - mt - mb);
  const muted = css('--muted'), line = css('--line'), water = css('--water'), accent = css('--accent');
  g.font = `10px ${css('--f-mono')}`; g.strokeStyle = line; g.fillStyle = muted;
  const vs = niceStep(Vmax, 4);
  for (let v = 0; v <= Vmax + 1e-9; v += vs) {
    g.beginPath(); g.moveTo(X(v), mt); g.lineTo(X(v), h - mb); g.stroke();
    g.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(+v.toFixed(1)), X(v) - 8, h - mb + 12);
  }
  const ss = niceStep(T0, 4);
  for (let s = 0; s <= T0 + 1e-9; s += ss) { g.beginPath(); g.moveTo(ml, Y(s)); g.lineTo(w - mr, Y(s)); g.stroke(); g.fillText(s.toFixed(2), 4, Y(s) + 3); }
  g.fillText('m³', w - mr - 14, h - 2);
  g.beginPath();
  rows.forEach((r, i) => { if (i) g.lineTo(X(r.vol), Y(r.stage)); else g.moveTo(X(r.vol), Y(r.stage)); });
  g.lineTo(X(0), Y(T0)); g.lineTo(X(0), Y(0)); g.closePath();
  g.fillStyle = water; g.globalAlpha = 0.12; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = accent; g.lineWidth = 2; g.beginPath();
  rows.forEach((r, i) => { if (i) g.lineTo(X(r.vol), Y(r.stage)); else g.moveTo(X(r.vol), Y(r.stage)); });
  g.stroke();
  const sWL = T0 - b.p.F, vWL = b.res.Vlive + b.res.Vdead;
  g.setLineDash([4, 3]); g.strokeStyle = water; g.lineWidth = 1;
  g.beginPath(); g.moveTo(ml, Y(sWL)); g.lineTo(X(vWL), Y(sWL)); g.lineTo(X(vWL), h - mb); g.stroke(); g.setLineDash([]);
  g.fillStyle = water; g.beginPath(); g.arc(X(vWL), Y(sWL), 3.5, 0, 7); g.fill();
  info.textContent = 'stage (m) vs volume';
}
