/** Entry point: wires the DOM to the model, drawing, import and export. */
import './styles.css';
import type { Pt } from './engine';
import { pointIn } from './engine';
import { CRS_LIST } from './io/crs';
import {
  PRESET, TYPE_LABEL, current, fmt, makeBasin, newParams, solve, state,
  type Basin, type BasinParams, type BasinType, type DesignMode,
} from './app/model';
import { exampleBasins } from './app/examples';
import { importFiles } from './app/importer';
import { buildExport, rasterVolume, saveFile, stageCsv, type RasterSettings } from './app/exporter';
import { drawPlan, drawSection, drawStage, fitView, screenToWorld, worldRim } from './app/draw';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const plan = $<HTMLCanvasElement>('plan');

// ---------- small helpers ----------
let toastTimer: number | undefined;
function toast(msg: string): void {
  if (!msg) return;
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4200);
}
const num = (id: string, fallback = 0) => { const v = Number(input(id).value); return isFinite(v) ? v : fallback; };
const rasterSettings = (): RasterSettings => ({
  cs: Math.max(0.05, num('cell', 1) || 1), ox: num('ox'), oy: num('oy'),
  poolFilled: $<HTMLSelectElement>('poolBurn').value === 'filled',
});
const contourInterval = () => Math.max(0.01, num('cint', 0.1) || 0.1);
function hideExampleBanner(): void { state.example = false; $('exampleBanner').hidden = true; }

// ---------- CRS select ----------
for (const c of CRS_LIST) {
  const o = document.createElement('option');
  o.value = c.id; o.textContent = c.label;
  $('crs').appendChild(o);
}

// ---------- basin list ----------
function renderList(): void {
  const el = $('feats');
  el.innerHTML = '';
  $('count').textContent = state.basins.length ? `(${state.basins.length})` : '';
  if (!state.basins.length) { el.innerHTML = '<p class="note">No basins yet. Import an outline or add a shape from dimensions.</p>'; return; }
  state.basins.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'feat' + (i === state.sel ? ' sel' : '');
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = TYPE_LABEL[b.p.type];
    const col = b.flag.lvl === 'bad' ? 'var(--bad)' : b.flag.lvl === 'warn' ? 'var(--warn)' : 'var(--ok)';
    row.innerHTML = `<span class="dot" style="background:${col}"></span><span class="nm"></span><span class="v">${fmt(b.res.Vlive, 1)} m³</span>`;
    row.querySelector('.nm')!.textContent = b.name;
    row.onclick = () => { state.sel = i; refreshAll(); };
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } };
    el.appendChild(row);
  });
}

// ---------- parameter form ----------
/** Form input id → parameter key. */
const FIELDS: Record<string, keyof BasinParams> = {
  pS: 'S', pF: 'F', pP: 'P', pM: 'm', pMinB: 'minB', pScale: 's', pSmooth: 'smooth', pRim: 'rimZ',
  pMedia: 'media', pPor: 'por', pInf: 'inf', pVt: 'Vt', pCA: 'CA', pC: 'C', pRain: 'rain',
};
const NULLABLE = new Set<keyof BasinParams>(['rimZ', 'CA']);
let lastFormId: number | null = null;

function show(id: string, on: boolean): void {
  $(id).hidden = !on;
  const lb = document.querySelector<HTMLElement>(`label[for=${id}]`);
  if (lb) lb.hidden = !on;
}

function renderForm(): void {
  const b = current();
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('aside.right input, aside.right select, aside.right button')
    .forEach(e => (e.disabled = !b));
  if (!b) { $('results').innerHTML = ''; $('status').textContent = 'No basin selected.'; return; }
  const P = b.p;
  input('pName').value = b.name;
  $<HTMLSelectElement>('pType').value = P.type;
  const same = lastFormId === b.id;
  lastFormId = b.id;
  for (const [id, k] of Object.entries(FIELDS)) {
    const el = input(id);
    if (same && document.activeElement === el) continue; // don't fight the user's typing
    const v = P[k];
    el.value = v == null ? '' : typeof v === 'number' ? String(+v.toFixed(3)) : String(v);
  }
  document.querySelectorAll<HTMLButtonElement>('#mode button').forEach(btn => btn.classList.toggle('on', btn.dataset.m === P.mode));
  input('pS').readOnly = P.mode === 'vdepth';
  input('pScale').readOnly = P.mode === 'vsize';
  show('pVt', P.mode !== 'depth');
  show('pP', P.type === 'wet');
  show('pMedia', P.type === 'raingarden');
  show('pPor', P.type === 'raingarden');
  $('soilHead').textContent = P.type === 'raingarden' ? 'Soil and infiltration' : 'Infiltration';
  renderResults(b);
}

function renderResults(b: Basin): void {
  const r = b.res, P = b.p, rz = P.rimZ;
  const st = $('status');
  st.className = 'status ' + b.flag.lvl;
  st.textContent = b.flag.msg;
  const z = (d: number) => (rz == null ? `−${fmt(d)} m` : `${fmt(rz - d)} m`);
  type Row = [string, string] | ['hr'];
  const rows: (Row | null)[] = [
    ['Live storage (design)', `<span class="big">${fmt(r.Vlive, 1)} m³</span>`],
    P.type === 'raingarden' ? ['Pore storage in media', `${fmt(r.Vmedia, 1)} m³`] : null,
    P.type === 'raingarden' ? ['Effective storage', `${fmt(r.Veff, 1)} m³`] : null,
    ['Freeboard volume', `${fmt(r.Vfb, 1)} m³`],
    P.type === 'wet' ? ['Permanent pool volume', `${fmt(r.Vdead, 1)} m³`] : null,
    ['Total excavation', `${fmt(r.Vtot, 1)} m³`], ['hr'],
    ['Storage depth', `${fmt(P.S, 3)} m`], ['Total depth', `${fmt(r.T, 2)} m`], ['Footprint scale', `${fmt(P.s, 3)} ×`], ['hr'],
    ['Rim area', `${fmt(r.rimA, 1)} m²`], ['Design water surface', `${fmt(r.Awl, 1)} m²`],
    P.type === 'wet' ? ['Permanent pool surface', `${fmt(r.Apool, 1)} m²`] : null,
    ['Bottom area', `${fmt(r.Abot, 1)} m²`], ['Largest inscribed radius', `${fmt(r.inradius, 2)} m`], ['hr'],
    ['Rim', rz == null ? '0.00 m (relative)' : `${fmt(rz)} m`], ['Design water level', z(P.F)],
    P.type === 'wet' ? ['Permanent pool level', z(P.F + P.S)] : null, ['Bottom', z(r.T)],
  ];
  if (P.CA != null && P.CA > 0) {
    const runoffArea = P.CA * (P.C || 0);
    rows.push(['hr'], ['Runoff it holds', `${fmt((r.Veff / runoffArea) * 1000, 1)} mm`],
      ['Design rain runoff', `${fmt((runoffArea * (P.rain || 0)) / 1000, 1)} m³`],
      ['Basin / catchment area', `${fmt((r.rimA / P.CA) * 100, 1)} %`]);
    if (P.inf > 0) rows.push(['Drain-down time (bottom only)', `${fmt(r.Vlive / ((r.Abot * P.inf) / 1000), 1)} h`]);
  }
  $('results').innerHTML = rows.filter((x): x is Row => x !== null)
    .map(x => (x[0] === 'hr' ? '<div class="hr"></div>' : `<div class="k">${x[0]}</div><div class="val">${x[1]}</div>`)).join('');
}

function onParam(e: Event): void {
  const b = current();
  if (!b) return;
  const el = e.target as HTMLInputElement;
  if (el.id === 'pName') { b.name = el.value; renderList(); return; }
  const k = FIELDS[el.id];
  if (!k) return;
  const p = b.p as unknown as Record<string, number | null>;
  if (NULLABLE.has(k)) p[k] = el.value === '' ? null : Number(el.value);
  else {
    const v = Number(el.value);
    if (el.value === '' || !isFinite(v)) return;
    p[k] = k === 'smooth' ? Math.max(0, Math.min(4, Math.round(v))) : Math.max(k === 's' ? 0.05 : 0, v);
  }
  solve(b);
  schedule();
}
document.querySelectorAll<HTMLInputElement>('aside.right input').forEach(el => el.addEventListener('input', onParam));

$<HTMLSelectElement>('pType').onchange = e => {
  const b = current(); if (!b) return;
  const t = (e.target as HTMLSelectElement).value as BasinType;
  Object.assign(b.p, PRESET[t], { type: t });
  solve(b); refreshAll();
};
document.querySelectorAll<HTMLButtonElement>('#mode button').forEach(btn => (btn.onclick = () => {
  const b = current(); if (!b) return;
  const m = btn.dataset.m as DesignMode;
  if (m !== 'depth' && b.p.mode === 'depth') b.p.Vt = Math.round(b.res.Vlive);
  b.p.mode = m;
  solve(b); refreshAll();
}));
$('btnRainVt').onclick = () => {
  const b = current();
  if (!b || !(b.p.CA && b.p.CA > 0)) { toast('Enter the catchment area first.'); return; }
  b.p.Vt = +((b.p.CA * b.p.C * b.p.rain) / 1000).toFixed(1);
  if (b.p.mode === 'depth') b.p.mode = 'vdepth';
  solve(b); refreshAll();
};
$('btnAll').onclick = () => {
  const b = current(); if (!b) return;
  const keys: (keyof BasinParams)[] = ['type', 'S', 'F', 'P', 'm', 'minB', 'smooth', 'media', 'por', 'inf', 'C', 'rain'];
  for (const o of state.basins) if (o !== b) {
    for (const k of keys) (o.p as unknown as Record<string, unknown>)[k] = b.p[k];
    if (b.p.mode === 'depth') o.p.mode = 'depth';
    solve(o);
  }
  refreshAll();
  toast(`Applied type, depths, slope and soil settings to ${state.basins.length - 1} other basin(s). Target volumes and scales were kept.`);
};
$('btnDel').onclick = () => {
  if (state.sel < 0) return;
  state.basins.splice(state.sel, 1);
  state.sel = Math.min(state.sel, state.basins.length - 1);
  refreshAll();
};
$('btnClear').onclick = () => { state.basins = []; state.sel = -1; hideExampleBanner(); refreshAll(); };
$<HTMLSelectElement>('crs').onchange = e => {
  state.crs = (e.target as HTMLSelectElement).value;
  $('crsNote').textContent = state.crs === 'src' && !state.srcPrj ? 'No imported .prj yet; exports will have no .prj.' : '';
};
['cell', 'ox', 'oy', 'cint', 'poolBurn'].forEach(id => $(id).addEventListener('input', schedule));

// ---------- add shape from dimensions ----------
$('btnAdd').onclick = () => {
  const L = num('addL'), W = num('addW'), rot = (num('addRot') * Math.PI) / 180;
  if (!(L > 0 && W > 0)) { toast('Length and width must be positive.'); return; }
  const v = state.view;
  const cx = input('addX').value !== '' ? num('addX') : v?.cx ?? 0;
  const cy = input('addY').value !== '' ? num('addY') : v?.cy ?? 0;
  const kind = $<HTMLSelectElement>('addShape').value;
  let pts: Pt[] = [];
  if (kind === 'rect') pts = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
  else if (kind === 'ellipse') for (let i = 0; i < 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([(L / 2) * Math.cos(a), (W / 2) * Math.sin(a)]); }
  else {
    const r = Math.min(W, L) / 2, hl = L / 2 - r;
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; pts.push([hl + r * Math.cos(a), r * Math.sin(a)]); }
    for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + (i / 16) * Math.PI; pts.push([-hl + r * Math.cos(a), r * Math.sin(a)]); }
  }
  pts = pts.map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  if (state.example) { state.basins = []; hideExampleBanner(); }
  const label = kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Strip';
  state.basins.push(makeBasin(`${label} ${L}×${W} m`, [pts], newParams(L * W > 150 ? 'dry' : 'raingarden')));
  state.sel = state.basins.length - 1;
  if (!v) fitView(plan);
  refreshAll();
};

// ---------- plan interaction ----------
let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
plan.addEventListener('pointerdown', e => {
  if (!state.view) return;
  drag = { x: e.clientX, y: e.clientY, cx: state.view.cx, cy: state.view.cy, moved: false };
  plan.setPointerCapture(e.pointerId); plan.classList.add('drag');
});
plan.addEventListener('pointermove', e => {
  const w = screenToWorld(plan, e.clientX, e.clientY), v = state.view;
  if (!w || !v) return;
  $('coords').textContent = `X ${w[0].toFixed(1)}  Y ${w[1].toFixed(1)}`;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    v.cx = drag.cx - dx / v.k; v.cy = drag.cy + dy / v.k;
    drawPlan(plan, contourInterval());
  }
});
plan.addEventListener('pointerup', e => {
  plan.classList.remove('drag');
  if (drag && !drag.moved) {
    const w = screenToWorld(plan, e.clientX, e.clientY);
    const i = w ? state.basins.findIndex(b => pointIn(w[0], w[1], worldRim(b))) : -1;
    if (i >= 0 && i !== state.sel) { state.sel = i; refreshAll(); }
  }
  drag = null;
});
plan.addEventListener('wheel', e => {
  e.preventDefault();
  const v = state.view; if (!v) return;
  const r = plan.getBoundingClientRect();
  const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
  const wx = v.cx + mx / v.k, wy = v.cy - my / v.k;
  v.k *= Math.exp(-e.deltaY * 0.0015);
  v.cx = wx - mx / v.k; v.cy = wy + my / v.k;
  drawPlan(plan, contourInterval());
}, { passive: false });
$('btnFit').onclick = () => { fitView(plan); drawPlan(plan, contourInterval()); };
$('btnRot').onclick = () => { state.secRot = !state.secRot; drawAll(); };

// ---------- import / export ----------
async function doImport(files: File[]): Promise<void> {
  try {
    const r = await importFiles(files);
    r.errors.forEach(toast);
    if (!r.count) return;
    hideExampleBanner();
    $<HTMLSelectElement>('crs').value = state.crs;
    $('crsNote').textContent = r.note;
    fitView(plan); refreshAll();
    toast(`Imported ${r.count} footprint${r.count > 1 ? 's' : ''}.`);
  } catch (e) { toast('Import failed: ' + (e as Error).message); }
}
const fileInput = input('file'), drop = $('drop');
fileInput.onchange = () => { void doImport([...(fileInput.files ?? [])]); fileInput.value = ''; };
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
document.addEventListener('dragleave', e => { e.preventDefault(); if (e.target === drop) drop.classList.remove('over'); });
document.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer?.files.length) void doImport([...e.dataTransfer.files]);
});

$('btnExport').onclick = async () => {
  if (!state.basins.length) { toast('Nothing to export yet.'); return; }
  try {
    const { zip, warnings } = buildExport(state.basins, rasterSettings(), contourInterval());
    warnings.forEach(toast);
    toast(await saveFile('basin_shaper_export.zip', zip));
  } catch (e) { toast('Export failed: ' + (e as Error).message); }
};
$('btnCsv').onclick = async () => {
  if (!state.basins.length) { toast('Nothing to export yet.'); return; }
  toast(await saveFile('stage_storage.csv', stageCsv(state.basins)));
};

// ---------- rendering ----------
function rasterNote(): void {
  const b = current(), el = $('rasterNote');
  if (!b) { el.textContent = ''; return; }
  const rs = rasterSettings(), r = rasterVolume(b, rs);
  if (!r) { el.className = 'note'; el.textContent = 'Cell size is very small for this basin; export may be slow.'; return; }
  const pct = b.res.Vlive > 0 ? (r.vol / b.res.Vlive) * 100 : 0, off = Math.abs(pct - 100) > 15;
  el.className = 'note' + (off ? ' warn' : '');
  el.textContent = `At ${rs.cs} m cells, "${b.name}" covers ${r.cells} cells and the raster holds ${fmt(r.vol, 1)} m³ live storage (${fmt(pct, 0)} % of the design volume).${off ? ' Use a finer DEM resolution or a larger basin.' : ''}`;
}

let rasterTimer: number | undefined;
function drawAll(): void {
  drawPlan(plan, contourInterval());
  drawSection($<HTMLCanvasElement>('section'), $('secInfo'));
  drawStage($<HTMLCanvasElement>('stage'), $('ssInfo'));
  clearTimeout(rasterTimer);
  rasterTimer = window.setTimeout(rasterNote, 120);
}
let raf = 0;
function schedule(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderList(); renderForm(); drawAll(); });
}
function refreshAll(): void {
  if (state.sel >= state.basins.length) state.sel = state.basins.length - 1;
  if (state.sel < 0 && state.basins.length) state.sel = 0;
  renderList(); renderForm(); drawAll();
}

new ResizeObserver(() => drawAll()).observe(document.querySelector('main')!);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
new MutationObserver(drawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
void document.fonts?.ready.then(drawAll);

// ---------- start with examples ----------
state.basins = exampleBasins();
state.sel = 1;
$<HTMLSelectElement>('crs').value = state.crs;
requestAnimationFrame(() => { fitView(plan); refreshAll(); });
