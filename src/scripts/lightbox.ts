// Full-screen photo viewer (lightbox). Self-contained: it receives the ordered
// entry list and callbacks from the caller and knows nothing about the file
// store. Native <dialog> gives top-layer rendering, ESC close and focus trap;
// this module adds navigation, full-gesture zoom/pan, and object-URL lifecycle.

import type { FileEntry } from '../lib/domain/stripPlan.ts';

export interface LightboxOptions {
  /** Reveal the file in the underlying list (called before the viewer closes). */
  onReveal?: (file: File) => void;
  /** Reuse an already-decoded object URL (e.g. the thumbnail's) for instant display. */
  resolveUrl?: (file: File) => string | undefined;
}

// — Pure helpers (exported for tests) —

/** Next index with wrap-around; safe for empty lists. */
export function stepIndex(current: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const ZOOM_STEP = 1.6;
export const DOUBLE_TAP_SCALE = 2.5;

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * Clamp pan so the scaled image can't be dragged off-stage. `dispW/dispH` is the
 * displayed (object-contain) size at scale 1; `stageW/stageH` the stage size.
 * Returns the bounded [tx, ty].
 */
export function clampPan(
  tx: number, ty: number, scale: number,
  dispW: number, dispH: number, stageW: number, stageH: number,
): [number, number] {
  // Half the overflow is the furthest an edge can travel before exposing the void.
  const axis = (v: number, overflow: number) =>
    overflow <= 0 ? 0 : Math.min(overflow / 2, Math.max(-overflow / 2, v));
  return [
    axis(tx, dispW * scale - stageW),
    axis(ty, dispH * scale - stageH),
  ];
}

// — DOM controller —

const TAP_MOVE_PX = 8;     // movement under this counts as a tap, not a drag
const SWIPE_PX = 55;       // horizontal travel to trigger prev/next
const DOUBLE_TAP_MS = 300;

let inited = false;
let dialog: HTMLDialogElement;
let img: HTMLImageElement;
let stage: HTMLElement;
let nameEl: HTMLElement;
let fallback: HTMLElement;
let zoomLabel: HTMLElement;
let btnPrev: HTMLButtonElement, btnNext: HTMLButtonElement;

let entries: FileEntry[] = [];
let index = 0;
let opts: LightboxOptions = {};

const ownUrls = new Map<File, string>();   // URLs we created and must revoke on close
let scale = 1, tx = 0, ty = 0;

const noGlass = () => document.documentElement.classList.contains('no-glass');
const currentFile = () => entries[index]?.file;

function urlFor(file: File): string {
  const shared = opts.resolveUrl?.(file);
  if (shared) return shared;
  let own = ownUrls.get(file);
  if (!own) { own = URL.createObjectURL(file); ownUrls.set(file, own); }
  return own;
}

function applyTransform(animate = false): void {
  img.style.transition = animate && !noGlass() ? 'transform 0.2s ease' : 'none';
  img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  img.style.cursor = scale > 1 ? 'grab' : '';
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

/** Displayed image size at scale 1 (object-contain fit into the stage). */
function displayedSize(): { w: number; h: number; sw: number; sh: number } {
  const r = stage.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return { w: r.width, h: r.height, sw: r.width, sh: r.height };
  const fit = Math.min(r.width / nw, r.height / nh);
  return { w: nw * fit, h: nh * fit, sw: r.width, sh: r.height };
}

function clampCurrentPan(): void {
  const d = displayedSize();
  [tx, ty] = clampPan(tx, ty, scale, d.w, d.h, d.sw, d.sh);
}

function resetZoom(animate = false): void {
  scale = 1; tx = 0; ty = 0;
  applyTransform(animate);
}

/** Zoom to `next` keeping the point at client (cx, cy) fixed on screen. */
function zoomTo(next: number, cx: number, cy: number, animate = false): void {
  const r = stage.getBoundingClientRect();
  const ox = cx - (r.left + r.width / 2);
  const oy = cy - (r.top + r.height / 2);
  const ns = clampScale(next);
  // Keep image-space point under cursor stationary.
  tx = ox - ((ox - tx) / scale) * ns;
  ty = oy - ((oy - ty) / scale) * ns;
  scale = ns;
  clampCurrentPan();
  applyTransform(animate);
}

function zoomToCenter(next: number): void {
  const r = stage.getBoundingClientRect();
  zoomTo(next, r.left + r.width / 2, r.top + r.height / 2, true);
}

function setNavDisabled(): void {
  const solo = entries.length <= 1;
  btnPrev.disabled = solo;
  btnNext.disabled = solo;
}

function show(i: number): void {
  index = i;
  const file = currentFile();
  if (!file) return;
  nameEl.textContent = file.name;
  resetZoom();
  fallback.classList.add('hidden');
  fallback.classList.remove('flex');
  img.style.visibility = '';
  img.onerror = () => {
    img.style.visibility = 'hidden';
    fallback.classList.remove('hidden');
    fallback.classList.add('flex');
  };
  img.src = urlFor(file);
  setNavDisabled();
  preloadNeighbours();
}

function preloadNeighbours(): void {
  if (entries.length <= 1) return;
  for (const dir of [-1, 1] as const) {
    const f = entries[stepIndex(index, entries.length, dir)]?.file;
    if (f) { const im = new Image(); im.src = urlFor(f); }
  }
}

function navigate(dir: 1 | -1): void {
  if (entries.length <= 1) return;
  show(stepIndex(index, entries.length, dir));
}

function close(): void { dialog.close(); }

function cleanup(): void {
  for (const url of ownUrls.values()) URL.revokeObjectURL(url);
  ownUrls.clear();
  img.removeAttribute('src');
  entries = [];
  opts = {};
}

// — Gesture state —

const pointers = new Map<number, { x: number; y: number }>();
let downX = 0, downY = 0, lastX = 0, lastY = 0, moved = false;
let panTx = 0, panTy = 0;                        // pan origin at pointerdown
let pinchDist = 0, pinchScale = 1;               // pinch origin
let lastTapTime = 0;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function onPointerDown(e: PointerEvent): void {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }

  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    pinchDist = dist(p1!, p2!);
    pinchScale = scale;
    moved = true;
    return;
  }
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
  moved = false;
  panTx = tx; panTy = ty;
}

function onPointerMove(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastX = e.clientX; lastY = e.clientY;

  if (pointers.size >= 2 && pinchDist > 0) {
    const [p1, p2] = [...pointers.values()];
    const m = midpoint(p1!, p2!);
    zoomTo(pinchScale * (dist(p1!, p2!) / pinchDist), m.x, m.y);
    return;
  }

  const dx = e.clientX - downX, dy = e.clientY - downY;
  if (!moved && Math.hypot(dx, dy) > TAP_MOVE_PX) moved = true;

  if (scale > 1) {            // pan
    tx = panTx + dx;
    ty = panTy + dy;
    clampCurrentPan();
    applyTransform();
  }
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  try { stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

  if (pointers.size === 1) {
    // One finger lifted after a pinch — re-anchor the remaining pointer so panning
    // doesn't jump.
    const rem = [...pointers.values()][0]!;
    downX = lastX = rem.x; downY = lastY = rem.y;
    panTx = tx; panTy = ty;
    pinchDist = 0;
    moved = true;
    return;
  }
  if (pointers.size > 0) return;

  if (pinchDist > 0) { pinchDist = 0; return; }

  if (!moved) {
    // Tap. On the backdrop (not the image) → close. On the image → double-tap zooms
    // (touch/pen only; mouse double-click is handled by the native dblclick listener).
    if (e.target !== img) { close(); return; }
    if (e.pointerType === 'mouse') return;
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) {
      lastTapTime = 0;
      if (scale > 1) resetZoom(true);
      else zoomTo(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
    } else {
      lastTapTime = now;
    }
    return;
  }

  // A drag: horizontal swipe navigates when not zoomed.
  if (scale <= 1) {
    const dx = lastX - downX, dy = lastY - downY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) navigate(dx < 0 ? 1 : -1);
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  zoomTo(scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), e.clientX, e.clientY);
}

function onKeyDown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowLeft':  navigate(-1); break;
    case 'ArrowRight': navigate(1); break;
    case '+': case '=': zoomToCenter(scale * ZOOM_STEP); break;
    case '-': case '_': zoomToCenter(scale / ZOOM_STEP); break;
    default: return;
  }
  e.preventDefault();
}

/** Wire the (static) shell once. Safe to call repeatedly. */
export function initLightbox(): void {
  if (inited) return;
  const d = document.getElementById('lightbox-modal');
  if (!d) return;            // shell not present (e.g. unit tests)
  inited = true;

  dialog = d as HTMLDialogElement;
  img = document.getElementById('lb-img') as HTMLImageElement;
  stage = document.getElementById('lb-stage')!;
  nameEl = document.getElementById('lb-name')!;
  fallback = document.getElementById('lb-fallback')!;
  zoomLabel = document.getElementById('lb-zoom-level')!;
  btnPrev = document.getElementById('lb-prev') as HTMLButtonElement;
  btnNext = document.getElementById('lb-next') as HTMLButtonElement;

  btnPrev.addEventListener('click', () => navigate(-1));
  btnNext.addEventListener('click', () => navigate(1));
  document.getElementById('lb-zoom-in')!.addEventListener('click', () => zoomToCenter(scale * ZOOM_STEP));
  document.getElementById('lb-zoom-out')!.addEventListener('click', () => zoomToCenter(scale / ZOOM_STEP));
  document.getElementById('lb-close')!.addEventListener('click', close);
  document.getElementById('lb-reveal')!.addEventListener('click', () => {
    const f = currentFile();
    close();
    if (f) opts.onReveal?.(f);
  });

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', e => {
    if (e.target !== img) return;
    e.preventDefault();
    if (scale > 1) resetZoom(true);
    else zoomTo(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
  });
  img.addEventListener('load', () => clampCurrentPan());
  dialog.addEventListener('keydown', onKeyDown);
  dialog.addEventListener('close', cleanup);
}

/** Open the viewer at `file`, navigating within `list`. */
export function openLightbox(file: File, list: FileEntry[], options: LightboxOptions = {}): void {
  initLightbox();
  if (!inited) return;
  entries = list;
  opts = options;
  pointers.clear();
  pinchDist = 0; moved = false; lastTapTime = 0;
  const i = entries.findIndex(e => e.file === file);
  if (!dialog.open) dialog.showModal();
  show(i < 0 ? 0 : i);
}
