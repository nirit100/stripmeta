// Full-screen photo viewer (lightbox). Self-contained: it receives the ordered
// entry list and callbacks from the caller and knows nothing about the file
// store. Native <dialog> gives top-layer rendering, ESC close and focus trap;
// this module adds a finger-following swipe carousel, full-gesture zoom/pan, and
// object-URL lifecycle.
//
// The stage holds a 3-pane track (prev / current / next). Swiping or hitting
// prev/next slides the track and then re-centers after swapping the panes'
// images — seamless because the destination pane already shows the next photo.
// Zoom/pan transform the centre image only and are disabled mid-swipe.

import type { FileEntry } from '../lib/domain/stripPlan.ts';

export interface LightboxOptions {
  /** Reveal the file in the underlying list (called before the viewer closes). */
  onReveal?: (file: File) => void;
  /** Open the metadata view for the file (the viewer stays open underneath). */
  onShowMetadata?: (file: File) => void;
  /** Reuse an already-decoded object URL (e.g. the thumbnail's) for instant display. */
  resolveUrl?: (file: File) => string | undefined;
}

// — Pure helpers (exported for tests) —

/** Step the index by `dir`, clamped to the valid range (no wrap). Safe for empty lists. */
export function stepIndex(current: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return Math.min(len - 1, Math.max(0, current + dir));
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
const SLIDE_MS = 260;
const EDGE_RESIST = 0.35;  // rubber-band factor when dragging past the first/last image

let inited = false;
let dialog: HTMLDialogElement;
let img: HTMLImageElement;          // centre pane (zoom/pan target) = panes[1]
let panes: HTMLImageElement[] = []; // the three pane images, in current DOM order
let stage: HTMLElement;
let track: HTMLElement;
let nameEl: HTMLElement;
let pathEl: HTMLElement;
let zoomLabel: HTMLElement;
let btnPrev: HTMLButtonElement, btnNext: HTMLButtonElement;

let entries: FileEntry[] = [];
let index = 0;
let opts: LightboxOptions = {};

const ownUrls = new Map<File, string>();   // URLs we created and must revoke on close
let scale = 1, tx = 0, ty = 0;
let trackX = 0;                             // current track translateX (px)
let animating = false;                      // true while a slide transition is running

const noGlass = () => document.documentElement.classList.contains('no-glass');
const currentFile = () => entries[index]?.file;
const hasPrev = () => index > 0;
const hasNext = () => index < entries.length - 1;
const stageW = () => stage.clientWidth;
const centerX = () => -stageW();            // track offset that centres the middle pane

/** Whether a client point lands on the visible image (not the dark surround). */
function pointOnImage(x: number, y: number): boolean {
  if (img.style.visibility === 'hidden') return false;
  const r = img.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function toggleZoomAt(x: number, y: number): void {
  if (scale > 1) resetZoom(true);
  else zoomTo(DOUBLE_TAP_SCALE, x, y, true);
}

function urlFor(file: File): string {
  const shared = opts.resolveUrl?.(file);
  if (shared) return shared;
  let own = ownUrls.get(file);
  if (!own) { own = URL.createObjectURL(file); ownUrls.set(file, own); }
  return own;
}

// — Zoom / pan (centre image) —

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

// — Track / panes / navigation —

function setTrack(x: number): void {
  trackX = x;
  track.style.transform = `translateX(${x}px)`;
}

/** Animate the track to `x`; resolves when settled (instant when reduced-motion). */
function slideTo(x: number): Promise<void> {
  const from = trackX;
  if (from === x || noGlass()) { setTrack(x); return Promise.resolve(); }
  const anim = track.animate(
    [{ transform: `translateX(${from}px)` }, { transform: `translateX(${x}px)` }],
    { duration: SLIDE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  );
  setTrack(x);
  return anim.finished.then(() => undefined, () => undefined);
}

/** The per-pane "can't preview" fallback (sibling of the pane's <img>). */
function fbOf(el: HTMLImageElement): HTMLElement {
  return el.parentElement!.querySelector('.lb-fallback') as HTMLElement;
}

/** Load `file` into a pane image, revealing that pane's fallback if it can't decode. */
function setPane(el: HTMLImageElement, file: File | undefined): void {
  const fb = fbOf(el);
  fb.classList.add('hidden');
  fb.classList.remove('flex');
  if (!file) { el.removeAttribute('src'); el.style.visibility = 'hidden'; return; }
  el.style.visibility = '';
  el.onerror = () => {
    el.style.visibility = 'hidden';
    fb.classList.remove('hidden');
    fb.classList.add('flex');
  };
  el.src = urlFor(file);
}

function updateMeta(): void {
  const entry = entries[index];
  if (!entry) return;
  nameEl.textContent = entry.file.name;
  // Show the full path underneath when it adds info (i.e. the file is in a folder).
  const showPath = !!entry.path && entry.path !== entry.file.name;
  pathEl.textContent = showPath ? entry.path : '';
  pathEl.classList.toggle('hidden', !showPath);
}

function setNavDisabled(): void {
  btnPrev.disabled = !hasPrev();
  btnNext.disabled = !hasNext();
}

/** Render the current index into the centre pane and its neighbours, centred. */
function render(): void {
  img = panes[1]!;
  resetZoom();
  updateMeta();
  setPane(panes[0]!, entries[index - 1]?.file);
  setPane(panes[1]!, entries[index]?.file);
  setPane(panes[2]!, entries[index + 1]?.file);
  setTrack(centerX());
  setNavDisabled();
}

/**
 * Commit a swipe/step by rotating the pane elements so the just-revealed
 * neighbour *becomes* the centre. The centred pane is never reloaded, so its
 * content (image or fallback) can't flash; only the newly exposed end pane loads.
 */
function commit(dir: 1 | -1): void {
  if (dir > 0) track.appendChild(track.firstElementChild!);                       // left pane → end
  else track.insertBefore(track.lastElementChild!, track.firstElementChild);      // right pane → front
  panes = (Array.from(track.children) as HTMLElement[]).map(w => w.querySelector('img')!);
  img = panes[1]!;
  index += dir;
  setTrack(centerX());            // re-centre instantly; the centred pane doesn't move on screen
  resetZoom();
  updateMeta();
  if (dir > 0) setPane(panes[2]!, entries[index + 1]?.file);
  else         setPane(panes[0]!, entries[index - 1]?.file);
  setNavDisabled();
}

function transitionTo(dir: 1 | -1, targetX: number): void {
  if (animating) return;
  resetZoom();          // unzoom the outgoing image so it isn't left scaled as a neighbour
  animating = true;
  slideTo(targetX).then(() => { commit(dir); animating = false; });
}

function navigate(dir: 1 | -1): void {
  if (stepIndex(index, entries.length, dir) === index) return;   // already at an end
  transitionTo(dir, dir > 0 ? centerX() - stageW() : centerX() + stageW());
}

function close(): void { dialog.close(); }

function cleanup(): void {
  for (const url of ownUrls.values()) URL.revokeObjectURL(url);
  ownUrls.clear();
  for (const el of panes) el.removeAttribute('src');
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
  if (animating) return;
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

  if (scale > 1) {                 // pan the zoomed image
    tx = panTx + dx;
    ty = panTy + dy;
    clampCurrentPan();
    applyTransform();
  } else if (moved) {              // drag the carousel (finger-following)
    const resist = (dx > 0 && !hasPrev()) || (dx < 0 && !hasNext()) ? EDGE_RESIST : 1;
    setTrack(centerX() + dx * resist);
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
    // Tap. Pointer capture retargets events to the stage, so hit-test by coordinate
    // rather than e.target. Off the image (dark surround) → close; on the image →
    // double-tap zooms (touch/pen only; mouse uses the native dblclick listener).
    if (!pointOnImage(lastX, lastY)) { close(); return; }
    if (e.pointerType === 'mouse') return;
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) { lastTapTime = 0; toggleZoomAt(lastX, lastY); }
    else lastTapTime = now;
    return;
  }

  // End of a carousel drag: commit to a neighbour past the threshold, else settle back.
  if (scale <= 1) {
    const dx = lastX - downX, dy = lastY - downY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      const dir = dx < 0 ? 1 : -1;
      if (stepIndex(index, entries.length, dir) !== index) {
        transitionTo(dir, dir > 0 ? centerX() - stageW() : centerX() + stageW());
        return;
      }
    }
    slideTo(centerX());            // snap back to the current image
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
  stage = document.getElementById('lb-stage')!;
  track = document.getElementById('lb-track')!;
  panes = (Array.from(track.children) as HTMLElement[]).map(w => w.querySelector('img')!);
  img = panes[1]!;
  nameEl = document.getElementById('lb-name')!;
  pathEl = document.getElementById('lb-path')!;
  zoomLabel = document.getElementById('lb-zoom-level')!;
  btnPrev = document.getElementById('lb-prev') as HTMLButtonElement;
  btnNext = document.getElementById('lb-next') as HTMLButtonElement;

  btnPrev.addEventListener('click', () => navigate(-1));
  btnNext.addEventListener('click', () => navigate(1));
  document.getElementById('lb-zoom-in')!.addEventListener('click', () => zoomToCenter(scale * ZOOM_STEP));
  document.getElementById('lb-zoom-out')!.addEventListener('click', () => zoomToCenter(scale / ZOOM_STEP));
  document.getElementById('lb-close')!.addEventListener('click', close);
  document.getElementById('lb-info')!.addEventListener('click', () => {
    const f = currentFile();
    if (f) opts.onShowMetadata?.(f);   // opens over the viewer; reuses the metadata modal
  });
  document.getElementById('lb-reveal')!.addEventListener('click', () => {
    const f = currentFile();
    // Capture onReveal before close() — close() fires the dialog's 'close'
    // event, which runs cleanup() and resets opts to {}. Reading opts.onReveal
    // afterward can silently grab nothing depending on how soon that runs.
    const reveal = opts.onReveal;
    close();
    if (f && reveal) reveal(f);
  });

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', e => {
    if (!pointOnImage(e.clientX, e.clientY)) return;
    e.preventDefault();
    toggleZoomAt(e.clientX, e.clientY);
  });
  // Any pane can become the centre after a rotation, so clamp on each one's load.
  for (const p of panes) p.addEventListener('load', () => clampCurrentPan());
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
  pinchDist = 0; moved = false; lastTapTime = 0; animating = false;
  index = Math.max(0, entries.findIndex(e => e.file === file));
  if (!dialog.open) dialog.showModal();
  render();
}
