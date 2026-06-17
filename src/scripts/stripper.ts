import { readMetadata, defaultStripperManager, paranoidStripperManager, browserCapabilities } from '../lib/stripMeta.ts';
import { iconSvg } from '../lib/icons.ts';
import { siGooglemaps, siOpenstreetmap, siApple } from 'simple-icons';
import { computeToProcess, collectBlobs } from '../lib/stripPlan.ts';
import type { FileEntry } from '../lib/stripPlan.ts';
import { buildTree, collectEntries, entriesUnder } from '../lib/fileTree.ts';
import type { DirNode } from '../lib/fileTree.ts';
import { StripState } from '../lib/stripState.ts';
import type { WarningLevel, MetadataPreview, StripperManager } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';
import { getSkipReason as _getSkipReason } from '../lib/skip.ts';
import { openMetadataModal } from './modal.ts';
import { settings, onSettingChange, collapseSettings, initSettings } from './settings.ts';
import { logEntry, clearLog, getLog, onLogChange, humanizeError } from './logger.ts';
import { registerErroredFile, clearErroredFiles } from '../lib/erroredFiles.ts';

const hero        = document.getElementById('hero') as HTMLElement;
const dropZone    = document.getElementById('drop-zone')!;
const fileInput   = document.getElementById('file-input') as HTMLInputElement;
const dirInput    = document.getElementById('dir-input') as HTMLInputElement;
const btnPickFiles = document.getElementById('btn-pick-files') as HTMLButtonElement;
const btnPickDir  = document.getElementById('btn-pick-dir') as HTMLButtonElement;
const fileList    = document.getElementById('file-list')!;
const fileWarningBanner = document.getElementById('file-warning-banner')!;
const actions     = document.getElementById('actions')!;
const btnStrip       = document.getElementById('btn-strip') as HTMLButtonElement;
const btnDownload    = document.getElementById('btn-download') as HTMLButtonElement;
const btnCopyResult  = document.getElementById('btn-copy-result') as HTMLButtonElement;
const btnClear       = document.getElementById('btn-clear') as HTMLButtonElement;
const dropZoneContent = document.getElementById('drop-zone-content')!;
const scanStateEl   = document.getElementById('scan-state')!;
const scanCountEl   = document.getElementById('scan-count')!;
const logSection    = document.getElementById('log-section')!;
const btnLogToggle  = document.getElementById('btn-log-toggle') as HTMLButtonElement;
const logPanel      = document.getElementById('log-panel')!;
const logEntriesEl  = document.getElementById('log-entries')!;
const btnClearLog       = document.getElementById('btn-clear-log') as HTMLButtonElement;
const stripProgressEl   = document.getElementById('strip-progress') as HTMLElement;
const fileListHeader    = document.getElementById('file-list-header')!;
const fileCountEl       = document.getElementById('file-count')!;
const fileListArea      = document.getElementById('file-list-area')!;

function updateFileListHeader() {
  const n = entries.length;
  const visible = n > 0;
  fileListHeader.classList.toggle('hidden', !visible);
  fileCountEl.textContent = visible ? `${n} image${n !== 1 ? 's' : ''}` : '';
}

function setScanState(active: boolean, count = 0) {
  dropZoneContent.classList.toggle('hidden', active);
  scanStateEl.classList.toggle('hidden', !active);
  scanStateEl.classList.toggle('flex', active);
  scanCountEl.textContent = active && count > 0
    ? `${count} image${count !== 1 ? 's' : ''} found so far…`
    : '';
  if (active && !actions.classList.contains('hidden')) {
    btnStrip.disabled = true;
    btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Scanning…';
  }
}

function activeManager(): StripperManager {
  return settings.paranoid ? paranoidStripperManager : defaultStripperManager;
}

const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, experimental: 2, none: 3 };


// — Data model —

const sessionStats = { filesProcessed: 0, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 };

// Runs at most `limit` calls of `fn` concurrently, preserving result order.
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    let next;
    while ((next = queue.shift())) results[next.i] = await fn(next.item);
  }));
  return results;
}

// Semaphore for metadata reads — limits concurrent exifr parses to avoid OOM on mobile.
let metaSlots = 6;
const metaWaiters: Array<() => void> = [];
function acquireMeta(): Promise<void> {
  return metaSlots > 0 ? (metaSlots--, Promise.resolve()) : new Promise(r => metaWaiters.push(r));
}
function releaseMeta() { const w = metaWaiters.shift(); if (w) w(); else metaSlots++; }

let entries: FileEntry[] = [];
let levelOf         = new Map<File, WarningLevel>();
let canConvertPngOf = new Map<File, boolean>();
let metadataCache = new Map<File, MetadataPreview>();
let heroCollapsed = false;
let renderGen = 0;
const state = new StripState();
let pendingBlobs: { path: string; blob: Blob }[] = [];

// DOM tracking
const rowOf          = new Map<File, HTMLElement>();
const urlOf          = new Map<File, string>();
const dirRowOf       = new Map<string, HTMLElement>();
const dirCounters    = new Map<string, () => void>(); // path -> update fn for the stat label
const copyBtnOf      = new Map<File, HTMLButtonElement>();

// — Directory breadcrumb

const dirBreadcrumb = document.createElement('div');
dirBreadcrumb.className = 'fixed z-50 px-3 py-1.5 text-sm text-base-content/80 bg-base-100/70 backdrop-blur-sm border border-base-300 rounded-xl transition-opacity duration-150 glass-elem';
dirBreadcrumb.style.cssText = 'top: 8px; left: 50%; transform: translateX(-50%); width: min(calc(100% - 2rem), 48rem); opacity: 0; pointer-events: none;';
document.body.appendChild(dirBreadcrumb);

window.addEventListener('scroll', () => {
  if (dirRowOf.size === 0) { dirBreadcrumb.style.opacity = '0'; dirBreadcrumb.style.pointerEvents = 'none'; return; }

  const CRUMB_BOTTOM = dirBreadcrumb.offsetHeight + 16; // breadcrumb height + margin

  // Priority 1: a dir header currently being covered by the breadcrumb
  let covered = '';
  let coveredTop = Infinity;
  for (const [path, wrap] of dirRowOf) {
    const headerTop = (wrap.firstElementChild as HTMLElement).getBoundingClientRect().top;
    if (headerTop >= 0 && headerTop < CRUMB_BOTTOM && headerTop < coveredTop) {
      covered = path;
      coveredTop = headerTop;
    }
  }
  if (covered) {
    dirBreadcrumb.textContent = '📁 ' + covered.replaceAll('/', ' / ') + ' /';
    dirBreadcrumb.style.opacity = '1';
    dirBreadcrumb.style.pointerEvents = 'auto';
    return;
  }

  // Priority 2: deepest dir that has scrolled off the top
  let best = '';
  for (const [path, wrap] of dirRowOf) {
    const rect = wrap.getBoundingClientRect();
    if (rect.top < 1 && rect.bottom > 0 && path.split('/').length > best.split('/').length) best = path;
  }
  if (best) {
    dirBreadcrumb.textContent = '📁 ' + best.replaceAll('/', ' / ') + ' /';
    dirBreadcrumb.style.opacity = '1';
    dirBreadcrumb.style.pointerEvents = 'auto';
  } else {
    dirBreadcrumb.style.opacity = '0';
    dirBreadcrumb.style.pointerEvents = 'none';
  }
}, { passive: true });

// — Log panel —

function updateLogUI() {
  const log = getLog();
  const errors   = log.filter(e => e.level === 'error').length;
  const warnings = log.filter(e => e.level === 'warning').length;

  let text: string;
  let colorCls: string;
  if (errors > 0) {
    const warnPart = warnings > 0 ? `, ${warnings} warning${warnings !== 1 ? 's' : ''}` : '';
    text     = `${errors} error${errors !== 1 ? 's' : ''}${warnPart} — click to expand`;
    colorCls = 'text-error hover:text-error hover:bg-base-200/50';
  } else if (warnings > 0) {
    text     = `${warnings} warning${warnings !== 1 ? 's' : ''} — click to expand`;
    colorCls = 'text-warning hover:text-warning hover:bg-base-200/50';
  } else {
    text     = 'No issues';
    colorCls = 'text-base-content/50 hover:text-base-content/70 hover:bg-base-200/50';
  }

  btnLogToggle.textContent = text;
  btnLogToggle.className = `w-full px-3 py-2 text-sm rounded-lg transition-colors text-center ${colorCls}`;

  logEntriesEl.innerHTML = '';
  for (const entry of log) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-3 px-4 py-3';

    const icon = document.createElement('span');
    icon.className = entry.level === 'error'
      ? 'text-error shrink-0 mt-0.5 text-xs font-bold'
      : 'text-warning shrink-0 mt-0.5 text-xs';
    icon.textContent = entry.level === 'error' ? '✕' : '⚠';

    const content = document.createElement('div');
    content.className = 'flex-1 min-w-0';

    const name = document.createElement('div');
    name.className = 'text-xs font-medium text-base-content/90 truncate';
    name.textContent = entry.fileName;

    const path = document.createElement('div');
    path.className = 'text-[0.65rem] text-base-content/50 truncate font-mono';
    path.textContent = entry.filePath;

    const msg = document.createElement('div');
    msg.className = 'text-xs text-base-content/65 mt-0.5';
    msg.textContent = entry.message;

    content.append(name, path, msg);
    li.append(icon, content);
    logEntriesEl.appendChild(li);
  }
}

onLogChange(updateLogUI);

// — Hero collapse/expand —

function collapseHero() {
  if (heroCollapsed) return;
  heroCollapsed = true;
  for (const a of hero.getAnimations()) a.cancel();
  const h = hero.scrollHeight;
  hero.style.overflow = 'hidden';
  const anim = hero.animate(
    [{ height: h + 'px', opacity: 1, marginBottom: '0px' },
     { height: '0px',    opacity: 0, marginBottom: '-2.5rem' }],
    { duration: 350, easing: 'ease', fill: 'forwards' },
  );
  anim.onfinish = () => { hero.hidden = true; anim.cancel(); hero.style.overflow = ''; };
}

function expandHero() {
  if (!heroCollapsed) return;
  heroCollapsed = false;
  for (const a of hero.getAnimations()) a.cancel();
  hero.hidden = false;
  hero.style.overflow = 'hidden';
  const h = hero.scrollHeight;
  const anim = hero.animate(
    [{ height: '0px',    opacity: 0, marginBottom: '-2.5rem' },
     { height: h + 'px', opacity: 1, marginBottom: '0px' }],
    { duration: 350, easing: 'ease', fill: 'both' },
  );
  anim.onfinish = () => { anim.cancel(); hero.style.overflow = ''; };
}

// — File removal —

function detachEntry(entry: FileEntry) {
  const url = urlOf.get(entry.file);
  if (url) URL.revokeObjectURL(url);
  urlOf.delete(entry.file);
  metadataCache.delete(entry.file);
  levelOf.delete(entry.file);
  canConvertPngOf.delete(entry.file);
  rowOf.delete(entry.file);
  copyBtnOf.delete(entry.file);
  state.remove(entry.file);
  entries = entries.filter(e => e !== entry);
}

function afterRemove() {
  collapseSettings();
  updateFileListHeader();
  if (entries.length === 0) {
    fileList.classList.add('hidden');
    actions.classList.add('hidden');
    logSection.classList.add('hidden');
    stripProgressEl.classList.add('hidden');
    fileWarningBanner.hidden = true;
    dirRowOf.clear();
    expandHero();
  } else {
    renderBanner();
    updateAllDirCounts();
  }
}

function removeEntry(entry: FileEntry) {
  const row = rowOf.get(entry.file);
  detachEntry(entry);
  if (!row) { afterRemove(); return; }
  row.style.transition = 'opacity 150ms ease-out';
  row.style.opacity = '0';
  setTimeout(() => { row.remove(); cleanEmptyDirs(); afterRemove(); }, 160);
}

function cleanEmptyDirs() {
  for (const [path, dirRow] of dirRowOf) {
    const stillHasFiles = entries.some(e => e.path === path + '/' + e.path.split('/').at(-1) ||
      e.path.startsWith(path + '/'));
    if (!stillHasFiles) { dirRow.remove(); dirRowOf.delete(path); }
  }
}

// — Swipe to remove —

function addSwipeToRemove(slideTarget: HTMLElement, removeTarget: HTMLElement, entry: FileEntry) {
  const hint = removeTarget.querySelector<HTMLElement>('.delete-hint');
  let startX = 0;
  slideTarget.addEventListener('touchstart', e => {
    startX = e.touches[0]!.clientX;
    slideTarget.style.transition = 'none';
    if (hint) hint.style.transition = 'none';
  }, { passive: true });
  slideTarget.addEventListener('touchmove', e => {
    const dx = Math.min(0, e.touches[0]!.clientX - startX);
    if (dx < 0) {
      slideTarget.style.transform = `translateX(${dx}px)`;
      if (hint) hint.style.opacity = String(Math.min(1, -dx / 80));
    }
  }, { passive: true });
  slideTarget.addEventListener('touchend', () => {
    const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(slideTarget.style.transform);
    const dx = match ? parseFloat(match[1]!) : 0;
    if (dx < -80) {
      slideTarget.style.transition = 'transform 180ms ease-out';
      slideTarget.style.transform = 'translateX(-110%)';
      setTimeout(() => { detachEntry(entry); removeTarget.remove(); cleanEmptyDirs(); afterRemove(); }, 190);
    } else {
      slideTarget.style.transition = 'transform 200ms ease-out';
      slideTarget.style.transform = '';
      if (hint) { hint.style.transition = 'opacity 200ms ease-out'; hint.style.opacity = '0'; }
      setTimeout(() => { slideTarget.style.transition = ''; }, 210);
    }
  });
}

// — Skip logic —

function getSkipReason(file: File) {
  return _getSkipReason(file, settings, levelOf, metadataCache);
}

function applySkipStatus(file: File) {
  if (state.done.has(file) || state.errored.has(file)) return;
  const row = rowOf.get(file);
  if (!row) return;
  const statusBadge = row.querySelector<HTMLElement>('.status-badge');
  if (!statusBadge) return;
  const reason = getSkipReason(file);
  row.classList.toggle('opacity-40', reason !== null);
  if (reason === 'unsupported') {
    statusBadge.hidden = true; // red ✕ Unsupported badge already covers this
  } else {
    statusBadge.hidden = false;
    if (reason === 'lossy')             statusBadge.textContent = 'Skipped — lossy only';
    else if (reason === 'experimental') statusBadge.textContent = 'Skipped — experimental';
    else if (reason === 'no-metadata')  statusBadge.textContent = 'Skipped — no metadata';
    else                                statusBadge.textContent = 'Ready';
  }
}

// — GPS map popover —

function showGpsPopover(anchor: HTMLElement, lat: number, lon: number, coordStr: string) {
  document.getElementById('gps-map-pop')?.remove();

  const pop = document.createElement('div');
  pop.id = 'gps-map-pop';
  pop.className = 'fixed z-50 bg-base-200 border border-base-300 rounded-lg shadow-lg overflow-hidden min-w-[13rem]';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-3 py-2 border-b border-base-300/60';
  const pinIcon = document.createElement('span');
  pinIcon.className = 'shrink-0 text-error/60';
  pinIcon.innerHTML = iconSvg('map-pin', 'w-4 h-4 block', '1.5');
  const coordText = document.createElement('span');
  coordText.className = 'text-xs font-mono text-base-content/55 select-all';
  coordText.textContent = coordStr;
  header.append(pinIcon, coordText);
  pop.appendChild(header);

  const brandIcon = (path: string) =>
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

  const services: [string, string, string][] = [
    ['OpenStreetMap', `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=14`, siOpenstreetmap.path],
    ['Google Maps',   `https://maps.google.com/?q=${lat},${lon}`,                       siGooglemaps.path],
    ['Apple Maps',    `https://maps.apple.com/?q=${lat},${lon}`,                        siApple.path],
  ];
  for (const [name, url, path] of services) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'flex items-center gap-2.5 px-3 py-2.5 text-xs text-base-content/70 hover:bg-base-300 hover:text-base-content transition-colors';
    const ico = document.createElement('span');
    ico.className = 'shrink-0 flex items-center text-base-content/40';
    ico.innerHTML = brandIcon(path);
    const label = document.createElement('span');
    label.textContent = name;
    a.append(ico, label);
    pop.appendChild(a);
  }
  document.body.appendChild(pop);

  // Position below the badge; nudge left if it clips the right edge.
  const rect = anchor.getBoundingClientRect();
  pop.style.top  = `${rect.bottom + 4}px`;
  const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8);
  pop.style.left = `${Math.max(8, left)}px`;

  const dismiss = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener('click', dismiss, true); }
  };
  // Defer so this click doesn't immediately dismiss the popover.
  setTimeout(() => document.addEventListener('click', dismiss, true), 0);
}

// — File card handler constants —

const COPY_BTN_CLASS = 'btn btn-ghost btn-xs btn-circle text-base-content/65 hover:text-primary hover:bg-primary/10 tooltip tooltip-left transition-colors';
const SVG_COPY_CLIP  = iconSvg('clipboard', 'w-3.5 h-3.5', '2');
const SVG_COPY_CHECK = iconSvg('check',     'w-3.5 h-3.5', '2.5');
const SVG_COPY_X     = iconSvg('x-mark',   'w-3.5 h-3.5', '2.5');

// — Badge helper —

function badge(cls: string, text: string, tip?: string, tipDir = 'tooltip-top'): HTMLElement {
  const el = document.createElement('span');
  el.className = `badge badge-xs [--size:1.25rem] cursor-default ${cls}${tip ? ` tooltip ${tipDir}` : ''}`;
  if (tip) el.dataset.tip = tip;
  // Inner span so text-overflow ellipsis works: flex items need an explicit child element
  // for truncation to fire at the correct edge instead of clipping symmetrically.
  const inner = document.createElement('span');
  inner.className = 'truncate min-w-0';
  inner.textContent = text;
  el.appendChild(inner);
  return el;
}

// — File card handlers —

function attachCopyHandler(file: File, copyBtn: HTMLButtonElement, defaultTip: string): void {
  let busy = false;
  copyBtn.addEventListener('click', async () => {
    if (busy) return;
    const blob = state.blobs.get(file);
    if (!blob) return;
    busy = true;
    copyBtn.disabled = true;
    copyBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
    try {
      // Resolve the blob before constructing ClipboardItem, bc Firefox does not
      // accept Promise values in ClipboardItem, only resolved Blobs.
      let clipBlob: Blob;
      if (blob.type === 'image/png') {
        clipBlob = blob;
      } else {
        const bmp = await createImageBitmap(blob);
        const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        canvas.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        clipBlob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipBlob })]);
      copyBtn.innerHTML = SVG_COPY_CHECK;
      copyBtn.className = 'btn btn-ghost btn-xs btn-circle text-success tooltip tooltip-left transition-colors';
      copyBtn.dataset.tip = 'Copied!';
      window.dispatchEvent(new CustomEvent('stripmeta:copied'));
    } catch (err) {
      console.error('[copy]', err);
      copyBtn.innerHTML = SVG_COPY_X;
      copyBtn.className = 'btn btn-ghost btn-xs btn-circle text-error tooltip tooltip-left transition-colors';
      copyBtn.dataset.tip = 'Failed';
      setTimeout(() => {
        copyBtn.innerHTML = SVG_COPY_CLIP;
        copyBtn.className = COPY_BTN_CLASS;
        copyBtn.dataset.tip = defaultTip;
        copyBtn.disabled = false;
        busy = false;
      }, 4000);
      return;
    }
    setTimeout(() => {
      copyBtn.innerHTML = SVG_COPY_CLIP;
      copyBtn.className = COPY_BTN_CLASS;
      copyBtn.dataset.tip = defaultTip;
      copyBtn.disabled = false;
      busy = false;
    }, 2000);
  });
}

function attachRemoveHandler(
  removeBtn: HTMLButtonElement,
  entry: FileEntry,
  deleteHint: HTMLElement,
  body: HTMLElement,
  row: HTMLElement,
): void {
  removeBtn.addEventListener('click', () => {
    if (window.matchMedia('(pointer: coarse)').matches) {
      deleteHint.style.opacity = '1';
      body.style.transition = 'transform 320ms ease-in';
      body.style.transform = 'translateX(-110%)';
      setTimeout(() => { detachEntry(entry); row.remove(); cleanEmptyDirs(); afterRemove(); }, 330);
    } else {
      removeEntry(entry);
    }
  });
}

async function loadFileMetadata(entry: FileEntry, badgesSlot: HTMLElement, detailsBtn: HTMLButtonElement): Promise<void> {
  const { file } = entry;
  await acquireMeta();
  try {
    const preview = await readMetadata(file);

    if (preview.gps) {
      const { latitude, longitude } = preview.gps;
      const coordStr = formatGps(latitude, longitude);
      const gpsBadge = document.createElement('button');
      gpsBadge.type = 'button';
      gpsBadge.className = 'badge badge-xs badge-error [--size:1.25rem] cursor-pointer tooltip tooltip-top';
      gpsBadge.dataset.tip = coordStr;
      const gpsInner = document.createElement('span');
      gpsInner.className = 'truncate min-w-0';
      gpsInner.textContent = '📍 GPS';
      gpsBadge.appendChild(gpsInner);
      gpsBadge.addEventListener('click', e => {
        e.stopPropagation();
        showGpsPopover(gpsBadge, latitude, longitude, coordStr);
      });
      badgesSlot.appendChild(gpsBadge);
    }
    if (preview.make || preview.model) {
      const cam = [preview.make, preview.model].filter(Boolean).join(' ');
      badgesSlot.appendChild(badge('badge-neutral max-w-[9rem]', '📷 ' + cam, cam));
    }
    if (preview.serialNumber) {
      badgesSlot.appendChild(badge('badge-warning', 'S/N', preview.serialNumber));
    }
    if (preview.dateTime) {
      const d = preview.dateTime instanceof Date
        ? preview.dateTime
        : new Date(String(preview.dateTime).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      badgesSlot.appendChild(badge('badge-neutral font-mono', '📅 ' + (!isNaN(d.getTime()) ? d.toDateString() : String(preview.dateTime))));
    }
    if (preview.software) {
      badgesSlot.appendChild(badge('badge-neutral max-w-[9rem]', '🛠️ ' + preview.software, preview.software));
    }
    if (preview.artist) {
      badgesSlot.appendChild(badge('badge-error max-w-[9rem]', '👤 ' + preview.artist, preview.artist));
    }
    if (preview.userComment) {
      badgesSlot.appendChild(badge('badge-warning', '💬 Comment', preview.userComment));
    }
    if (preview.parseErrored) {
      badgesSlot.appendChild(badge('badge-warning', '⚠ unreadable', 'Metadata could not be parsed'));
    }

    metadataCache.set(file, preview);

    if (preview.parseErrored && getSkipReason(file) === null) {
      logEntry({ level: 'warning', fileName: file.name, filePath: entry.path, message: 'Could not read metadata' });
    }
    if (!preview.hasAnyMetadata && !preview.parseErrored) detailsBtn.textContent = 'no metadata';

    applySkipStatus(file);
    syncFlatList();
    updateAllDirCounts();
  } catch (err) {
    logEntry({ level: 'warning', fileName: file.name, filePath: entry.path, message: 'Could not read metadata: ' + humanizeError(err) });
  } finally {
    releaseMeta();
  }
}

// — File card —

function renderFileCard(entry: FileEntry, level: WarningLevel): HTMLElement {
  const { file } = entry;
  const row = document.createElement('div');
  const noGlass = document.documentElement.classList.contains('no-glass');
  row.className = `card card-bordered bg-base-200 shadow-none transition-opacity relative overflow-hidden${noGlass ? '' : ' card-new'}`;
  row.dataset.type = file.type;
  rowOf.set(file, row);

  const deleteHint = document.createElement('div');
  deleteHint.className = 'delete-hint absolute inset-y-0 right-0 flex items-center gap-2 px-6 bg-error text-error-content text-sm font-semibold pointer-events-none select-none opacity-0';
  deleteHint.textContent = '✕ Remove';
  row.appendChild(deleteHint);

  const body = document.createElement('div');
  body.className = 'card-body p-4 flex-row items-start gap-3 bg-base-200 relative';

  const objUrl = URL.createObjectURL(file);
  urlOf.set(file, objUrl);
  const thumb = document.createElement('img');
  thumb.className = 'w-12 h-12 rounded object-cover shrink-0 bg-base-300';
  thumb.src = objUrl;
  thumb.alt = '';
  thumb.draggable = false;
  thumb.loading = 'lazy';

  const left = document.createElement('div');
  left.className = 'flex-1 min-w-0 self-stretch flex flex-col justify-between';

  const nameEl = document.createElement('div');
  nameEl.className = 'text-sm font-medium leading-snug flex min-w-0';

  const lastDot = file.name.lastIndexOf('.');
  const hasExt  = lastDot > 0 && lastDot < file.name.length - 1;
  const ext  = hasExt ? file.name.slice(lastDot) : '';
  const base = hasExt ? file.name.slice(0, lastDot) : file.name;
  const TAIL = 4;

  const nameHead = document.createElement('span');
  nameHead.className = 'truncate min-w-0';
  nameHead.textContent = base.length > TAIL ? base.slice(0, -TAIL) : '';

  const nameTail = document.createElement('span');
  nameTail.className = 'shrink-0 whitespace-nowrap';
  nameTail.textContent = (base.length > TAIL ? base.slice(-TAIL) : base) + ext;

  nameEl.append(nameHead, nameTail);

  const subline = document.createElement('div');
  subline.className = 'flex flex-wrap items-center gap-1.5';

  const sizeSpan = document.createElement('span');
  sizeSpan.className = 'text-xs text-base-content/45 shrink-0';
  sizeSpan.textContent = formatBytes(file.size);

  const badgesSlot = document.createElement('div');
  badgesSlot.className = 'contents';
  subline.append(sizeSpan, badgesSlot);
  left.append(nameEl, subline);

  const right = document.createElement('div');
  right.className = 'flex flex-col items-end shrink-0 self-stretch';

  const topRow = document.createElement('div');
  topRow.className = 'flex items-center gap-1.5';

  if (level === 'unsupported') {
    topRow.appendChild(badge('badge-error badge-sm', '✕ Unsupported', 'Cannot be decoded in this browser — stripping will fail', 'tooltip-left'));
  }

  const statusBadge = document.createElement('span');
  if (state.done.has(file)) {
    statusBadge.className = 'badge badge-success badge-sm status-badge';
    statusBadge.textContent = 'Done';
  } else if (state.errored.has(file)) {
    statusBadge.className = 'badge badge-error badge-sm status-badge';
    statusBadge.textContent = 'Error';
  } else {
    statusBadge.className = 'badge badge-outline badge-sm status-badge';
    statusBadge.textContent = 'Ready';
  }
  topRow.appendChild(statusBadge);

  if (level !== 'unsupported' && canConvertPngOf.get(file) && !!navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = COPY_BTN_CLASS;
    const defaultTip = file.type === 'image/png' ? 'Copy to clipboard' : 'Copy as PNG';
    copyBtn.dataset.tip = defaultTip;
    copyBtn.innerHTML = SVG_COPY_CLIP;
    copyBtn.hidden = !state.done.has(file);
    copyBtnOf.set(file, copyBtn);
    attachCopyHandler(file, copyBtn, defaultTip);
    topRow.appendChild(copyBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-ghost btn-xs btn-circle -mr-1 text-error/80 hover:text-error-content hover:bg-error';
  removeBtn.innerHTML = '&times;';
  attachRemoveHandler(removeBtn, entry, deleteHint, body, row);
  topRow.appendChild(removeBtn);
  right.appendChild(topRow);

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';
  right.appendChild(spacer);

  const handlerRow = document.createElement('div');
  handlerRow.className = 'flex items-center justify-end gap-1.5';
  const handlerInfo = document.createElement('span');
  handlerInfo.className = 'text-xs text-base-content/35';
  handlerRow.appendChild(handlerInfo);
  right.appendChild(handlerRow);

  body.append(thumb, left, right);
  row.appendChild(body);

  activeManager().resolve(file).then(h => {
    handlerInfo.textContent = h.name;
    if (level === 'lossy') {
      const lossyLabel = document.createElement('span');
      lossyLabel.className = 'text-xs text-warning tooltip tooltip-left cursor-default';
      lossyLabel.textContent = '⚠️ Lossy';
      lossyLabel.dataset.tip = 'Output will be re-encoded as JPEG (small quality loss)';
      handlerRow.appendChild(lossyLabel);
    }
    if (h.experimental) {
      handlerRow.appendChild(badge(
        'badge-warning badge-outline badge-xs tooltip tooltip-left',
        'Experimental',
        'Metadata stripping for this format is new — some files may fail',
        'tooltip-left',
      ));
    }
  }).catch(err => console.warn('[handler resolve]', err));

  applySkipStatus(file);

  if (level !== 'unsupported') {
    const sep = document.createElement('span');
    sep.className = 'text-base-content/30 text-xs select-none shrink-0 mx-1';
    sep.textContent = '·';

    const detailsBtn = document.createElement('button');
    detailsBtn.type = 'button';
    detailsBtn.className = 'text-xs text-base-content/40 hover:text-primary transition-colors shrink-0 py-0 leading-none inline-flex items-center';
    detailsBtn.textContent = 'details…';
    detailsBtn.addEventListener('click', () => openMetadataModal(file, activeManager()));

    subline.append(sep, detailsBtn);
    void loadFileMetadata(entry, badgesSlot, detailsBtn);
  }

  addSwipeToRemove(body, row, entry);
  return row;
}

// — Directory row —

function renderDirRow(node: DirNode, defaultExpanded: boolean, container: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'w-full';
  dirRowOf.set(node.path, wrap);

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-3 py-2 rounded-xl bg-base-200/60 border border-base-300 cursor-pointer select-none hover:bg-base-200 transition-colors';

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '2.5');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.classList.add('w-3', 'h-3', 'text-base-content/40', 'transition-transform', 'duration-200', 'shrink-0');
  const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('stroke-linecap', 'round');
  chevronPath.setAttribute('stroke-linejoin', 'round');
  chevronPath.setAttribute('d', 'M9 5l7 7-7 7');
  chevron.appendChild(chevronPath);

  const label = document.createElement('span');
  label.className = 'text-sm font-medium flex-1 min-w-0 truncate';
  label.textContent = `📁 ${node.name}/`;

  const countBadge = document.createElement('span');
  countBadge.className = 'text-xs text-base-content/40 shrink-0';

  const statusDot = document.createElement('span');
  statusDot.className = 'w-2 h-2 rounded-full shrink-0 hidden';

  function updateCount() {
    const under = entriesUnder(entries, node.path);
    const n = under.length;
    let incompatible = 0, clean = 0, stripErrors = 0, done = 0;
    for (const e of under) {
      const r = getSkipReason(e.file);
      if (r === 'unsupported' || r === 'lossy' || r === 'experimental') incompatible++;
      else if (r === 'no-metadata') clean++;
      if (state.errored.has(e.file)) stripErrors++;
      if (state.done.has(e.file))   done++;
    }
    const skipped = incompatible + clean;
    const ready = n - skipped;
    let stat = `${n} file${n !== 1 ? 's' : ''}`;
    if (n > 0 && levelOf.size > 0) {
      const parts: string[] = [];
      if (ready > 0)        parts.push(`${ready} ready`);
      if (incompatible > 0) parts.push(`${incompatible} incompatible`);
      if (clean > 0)        parts.push(`${clean} no metadata`);
      if (stripErrors > 0)  parts.push(`${stripErrors} error${stripErrors !== 1 ? 's' : ''}`);
      stat += ' · ' + (parts.length ? parts.join(', ') : 'all skipped');
    }
    countBadge.textContent = stat;

    // Status dot: green = all done (≥1), red = any errors, hidden = not run or all skipped
    if (stripErrors > 0) {
      statusDot.className = 'w-2 h-2 rounded-full shrink-0 bg-error';
    } else if (done > 0) {
      statusDot.className = 'w-2 h-2 rounded-full shrink-0 bg-success';
    } else {
      statusDot.className = 'w-2 h-2 rounded-full shrink-0 hidden';
    }

    // Dim the row if no files are ready to strip
    wrap.style.opacity = (n > 0 && levelOf.size > 0 && ready === 0) ? '0.45' : '';
  }

  dirCounters.set(node.path, updateCount);
  updateCount();

  const removeDir = document.createElement('button');
  removeDir.type = 'button';
  removeDir.className = 'btn btn-ghost btn-xs btn-circle -mr-1 text-error/80 hover:text-error-content hover:bg-error';
  removeDir.innerHTML = '&times;';
  removeDir.addEventListener('click', e => {
    e.stopPropagation();
    removeDirNode(node);
  });

  header.append(chevron, label, countBadge, statusDot, removeDir);

  const children = document.createElement('div');
  children.className = 'flex flex-col gap-2 mt-2 ml-[1.1rem] pl-3 border-l-2 border-base-300/70';
  children.hidden = true;

  let materialised = false;

  function expand() {
    chevron.style.transform = 'rotate(90deg)';
    if (!materialised) {
      materialised = true;
      materialiseDir(node, children);
    }
    children.hidden = false;
    updateFabs();
  }
  function collapse() {
    chevron.style.transform = '';
    children.hidden = true;
    updateFabs();
  }

  header.addEventListener('click', () => {
    children.hidden ? expand() : collapse();
  });

  wrap.append(header, children);
  container.appendChild(wrap);

  if (defaultExpanded) expand();

  return wrap;
}

function materialiseDir(node: DirNode, container: HTMLElement) {
  for (const sub of node.subdirs.values()) {
    renderDirRow(sub, false, container);
  }
  for (const entry of node.files) {
    const level = levelOf.get(entry.file) ?? 'none';
    container.appendChild(renderFileCard(entry, level));
  }
}

function removeDirNode(node: DirNode) {
  const allEntries = collectEntries(node);
  for (const entry of allEntries) {
    const url = urlOf.get(entry.file);
    if (url) URL.revokeObjectURL(url);
    urlOf.delete(entry.file);
    metadataCache.delete(entry.file);
    levelOf.delete(entry.file);
    canConvertPngOf.delete(entry.file);
    rowOf.delete(entry.file);
  }
  entries = entries.filter(e => !allEntries.includes(e));
  const wrap = dirRowOf.get(node.path);
  wrap?.remove();
  dirRowOf.delete(node.path);
  afterRemove();
}

// — Directory counts —

function updateAllDirCounts() {
  for (const update of dirCounters.values()) update();
}

// — Flat-mode sorting (only when no directory structure) —

function isFlatMode() {
  return entries.every(e => !e.path.includes('/'));
}

function syncFlatList() {
  if (!isFlatMode()) return;
  const sorted = [...entries].sort((a, b) => {
    const aSkip = getSkipReason(a.file) !== null ? 1 : 0;
    const bSkip = getSkipReason(b.file) !== null ? 1 : 0;
    if (aSkip !== bSkip) return aSkip - bSkip;
    return WARNING_ORDER[levelOf.get(a.file) ?? 'none'] - WARNING_ORDER[levelOf.get(b.file) ?? 'none'];
  });
  for (const entry of sorted) {
    const row = rowOf.get(entry.file);
    if (row) fileList.appendChild(row); // reorder in-place
    applySkipStatus(entry.file);
  }
}

// — Banner —

function renderBanner() {
  const levels = [...levelOf.values()];
  const lossy        = levels.filter(l => l === 'lossy').length;
  const unsupported  = levels.filter(l => l === 'unsupported').length;
  const experimental = levels.filter(l => l === 'experimental').length;

  if (!lossy && !unsupported && !experimental) { fileWarningBanner.hidden = true; fileWarningBanner.innerHTML = ''; return; }

  const lines: string[] = [];
  if (unsupported) lines.push(`<span class="text-error font-medium">${unsupported} file${unsupported > 1 ? 's' : ''} cannot be processed</span> — format not supported in this browser.`);
  if (lossy) {
    const plural = lossy > 1;
    if (!settings.paranoid && settings.skipUnsupported) {
      lines.push(`<span class="text-warning font-medium">${lossy} file${plural ? 's' : ''} will be skipped</span> — no lossless handler exists for ${plural ? 'their' : 'its'} format${plural ? 's' : ''}.`);
    } else {
      const reason = settings.paranoid ? 'because paranoid mode is enabled.' : `no lossless handler exists for ${plural ? 'their' : 'its'} format${plural ? 's' : ''}.`;
      lines.push(`<span class="text-warning font-medium">${lossy} file${plural ? 's' : ''} will be re-encoded as JPEG</span> — ${reason}`);
    }
  }

  if (experimental) {
    const p = experimental > 1;
    if (settings.skipExperimental && !settings.paranoid) {
      lines.push(`<span class="text-base-content/60 font-medium">${experimental} file${p ? 's' : ''} will be skipped</span> — experimental format${p ? 's' : ''} (HEIC/AVIF) disabled in settings.`);
    } else {
      lines.push(`<span class="text-warning font-medium">${experimental} file${p ? 's' : ''} will use an experimental handler</span> — review the output carefully before sharing.`);
    }
  }

  fileWarningBanner.hidden = false;
  fileWarningBanner.innerHTML = `<div class="flex flex-col gap-1 text-sm px-4 py-3 rounded-xl border border-base-300 text-base-content/70">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}

// — Main render —

async function render() {
  const gen = ++renderGen;

  fileList.innerHTML = '';
  rowOf.clear();
  dirRowOf.clear();
  dirCounters.clear();
  copyBtnOf.clear();

  const visible = entries.length > 0;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);
  logSection.classList.toggle('hidden', !visible);
  updateFileListHeader();

  if (!visible) { fileWarningBanner.hidden = true; stripProgressEl.classList.add('hidden'); expandHero(); updateFabs(); return; }

  collapseHero();
  btnStrip.disabled = true;
  btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Analysing…';

  const classified = await pooled(entries, 8, async e => {
    const level = await activeManager().classify(e.file);
    // Lossless (incl. experimental): output type = input type. Lossy (canvas): output is JPEG.
    const canConvertPng = level === 'lossy'
      || e.file.type === 'image/png'
      || (level !== 'unsupported' && await browserCapabilities.canDecodeImage(e.file.type));
    return { level, canConvertPng };
  });

  // A newer render() call started while we were classifying — let it own the result.
  if (gen !== renderGen) return;

  levelOf         = new Map(entries.map((e, i) => [e.file, classified[i]!.level]));
  canConvertPngOf = new Map(entries.map((e, i) => [e.file, classified[i]!.canConvertPng]));

  const tree = buildTree(entries);
  const defaultExpanded = entries.length <= 10;

  // Root-level files (no directory)
  for (const entry of tree.files) {
    fileList.appendChild(renderFileCard(entry, levelOf.get(entry.file)!));
  }
  // Directory nodes
  for (const sub of tree.subdirs.values()) {
    renderDirRow(sub, defaultExpanded, fileList);
  }

  renderBanner();
  btnDownload.hidden = true;
  btnCopyResult.hidden = true;
  btnStrip.hidden = false;
  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata';
}

// — Adding files —

async function* scanDirectoryEntry(entry: FileSystemEntry): AsyncGenerator<FileEntry> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej));
    if (file.type.startsWith('image/')) {
      yield { file, path: entry.fullPath.replace(/^\//, '') };
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const child of batch) yield* scanDirectoryEntry(child);
    } while (batch.length > 0);
  }
}

async function addEntries(incoming: FileEntry[]) {
  const images = incoming.filter(e => e.file.type.startsWith('image/'));
  const existing = new Set(entries.map(e => e.file));
  const fresh = images.filter(e => !existing.has(e.file));
  const wasEmpty = entries.length === 0;
  entries = [...entries, ...fresh];
  collapseSettings();
  await render();
  if (wasEmpty && entries.length > 0) {
    requestAnimationFrame(() => fileListArea.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function fromFileList(fileList: FileList | File[], getPath: (f: File) => string): FileEntry[] {
  return [...fileList].map(f => ({ file: f, path: getPath(f) }));
}

// — Strip & download —

async function stripAndDownload() {
  if (!entries.length) return;
  collapseSettings();

  // Preserve done state; clear only errors so they get retried.
  state.resetErrors();
  clearErroredFiles();
  pendingBlobs = [];
  btnDownload.hidden = true;

  const toProcess = computeToProcess(entries, getSkipReason, state.done);

  let hadErrors = false;

  if (toProcess.length > 0) {
    btnStrip.disabled = true;
    btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Processing…';
    stripProgressEl.classList.remove('hidden');
    let doneCount = 0;

    await pooled(toProcess, 3, async entry => {
      const { file, path } = entry;
      const statusBadge = rowOf.get(file)?.querySelector<HTMLElement>('.status-badge');
      try {
        stripProgressEl.textContent = `${++doneCount} / ${toProcess.length} — ${file.name}`;
        const blob = await activeManager().strip(file);
        sessionStats.filesProcessed++;
        const preview = metadataCache.get(file);
        if (preview?.gps)      sessionStats.gpsRemoved++;
        if (preview?.dateTime) sessionStats.datesRemoved++;
        sessionStats.bytesStripped += Math.max(0, file.size - blob.size);
        state.markDone(file, blob);
        const copyBtn = copyBtnOf.get(file);
        if (copyBtn) copyBtn.hidden = false;
        if (statusBadge) { statusBadge.textContent = 'Done'; statusBadge.className = 'badge badge-success badge-sm status-badge'; }
      } catch (err) {
        hadErrors = true;
        state.markError(file);
        registerErroredFile(file, path);
        if (statusBadge) { statusBadge.textContent = 'Error'; statusBadge.className = 'badge badge-error badge-sm status-badge'; }
        logEntry({ level: 'error', fileName: file.name, filePath: path, message: humanizeError(err) });
      }
    });
  }

  // Collect blobs: done files + optionally skipped.
  const blobs = collectBlobs(entries, getSkipReason, state.done, state.blobs, settings.includeSkipped);

  // Update skip badges (done/error badges are already set above).
  for (const { file } of entries) {
    if (!state.done.has(file) && getSkipReason(file) !== null) {
      const statusBadge = rowOf.get(file)?.querySelector<HTMLElement>('.status-badge');
      if (statusBadge) {
        if (settings.includeSkipped) {
          statusBadge.textContent = 'Copied'; statusBadge.className = 'badge badge-outline badge-sm status-badge';
        } else {
          statusBadge.textContent = 'Skipped'; statusBadge.className = 'badge badge-outline badge-sm status-badge';
        }
      }
    }
  }

  pendingBlobs = blobs;
  if (blobs.length >= 1) {
    btnDownload.innerHTML = `${iconSvg('arrow-down-tray', 'w-4 h-4', '1.5')} ${blobs.length === 1 ? 'Save' : 'Save ZIP'}`;
    btnDownload.hidden = false;
    btnStrip.hidden = true;
  }
  if (blobs.length === 1 && !!navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const blobType = blobs[0]!.blob.type;
    const canConvert = blobType === 'image/png' || await browserCapabilities.canDecodeImage(blobType);
    if (canConvert) {
      const label = blobType === 'image/png' ? 'Copy to clipboard' : 'Copy as PNG';
      btnCopyResult.innerHTML = `${iconSvg('clipboard', 'w-4 h-4', '2')} ${label}`;
      btnCopyResult.disabled = false;
      btnCopyResult.hidden = false;
    } else {
      btnCopyResult.hidden = true;
    }
  } else {
    btnCopyResult.hidden = true;
  }

  stripProgressEl.classList.add('hidden');
  stripProgressEl.textContent = '';
  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata';
  updateAllDirCounts();

  if (blobs.length > 0) {
    try { window.dispatchEvent(new CustomEvent('stripmeta:processed', { detail: { ...sessionStats, hadErrors } })); } catch { /* ignore */ }
  }
}

function download(url: string, filename: string) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// — Event wiring —

btnPickFiles.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

const folderWarningModal = document.getElementById('folder-warning-modal') as HTMLDialogElement | null;
const btnFolderWarningConfirm = document.getElementById('btn-folder-warning-confirm') as HTMLButtonElement | null;

btnPickDir.addEventListener('click', e => {
  e.stopPropagation();
  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  if (isMobile && folderWarningModal) {
    folderWarningModal.showModal();
  } else {
    dirInput.click();
  }
});

btnFolderWarningConfirm?.addEventListener('click', () => {
  folderWarningModal?.close();
  dirInput.click();
});
dropZone.addEventListener('click', e => {
  if ((e.target as Element).closest('button, input')) return;
  fileInput.click();
});
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

fileInput.addEventListener('change', () => {
  if (fileInput.files) addEntries(fromFileList(fileInput.files, f => f.name));
  fileInput.value = '';
});

dirInput.addEventListener('change', () => {
  if (dirInput.files) {
    addEntries(fromFileList(dirInput.files, f =>
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name));
  }
  dirInput.value = '';
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('border-teal-500/50', 'bg-teal-500/5');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-teal-500/50', 'bg-teal-500/5');
});
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('border-teal-500/50', 'bg-teal-500/5');

  const items = [...(e.dataTransfer?.items ?? [])];
  const fsEntries = items.map(i => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];

  if (fsEntries.length > 0) {
    setScanState(true);
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const collected: FileEntry[] = [];
    for (const fsEntry of fsEntries) {
      try {
        for await (const fe of scanDirectoryEntry(fsEntry)) {
          collected.push(fe);
          setScanState(true, collected.length);
        }
      } catch (err) {
        logEntry({ level: 'warning', fileName: fsEntry.name, filePath: fsEntry.fullPath.replace(/^\//, ''), message: 'Could not scan directory: ' + humanizeError(err) });
      }
    }
    setScanState(false);
    addEntries(collected);
  } else if (e.dataTransfer?.files) {
    addEntries(fromFileList(e.dataTransfer.files, f => f.name));
  }
});

btnClear.addEventListener('click', () => {
  collapseSettings();
  for (const url of urlOf.values()) URL.revokeObjectURL(url);
  urlOf.clear();
  entries = [];
  levelOf.clear();
  canConvertPngOf.clear();
  metadataCache.clear();
  dirRowOf.clear();
  dirCounters.clear();
  copyBtnOf.clear();
  state.invalidate();
  pendingBlobs = [];
  btnDownload.hidden = true;
  clearLog();
  render();
});

btnLogToggle.addEventListener('click', () => {
  logPanel.classList.toggle('hidden');
});

btnClearLog.addEventListener('click', () => {
  clearLog();
  logPanel.classList.add('hidden');
});

btnStrip.addEventListener('click', stripAndDownload);

btnDownload.addEventListener('click', async () => {
  if (!pendingBlobs.length) return;
  if (pendingBlobs.length === 1) {
    const { path, blob } = pendingBlobs[0]!;
    download(URL.createObjectURL(blob), path.split('/').at(-1) ?? path);
  } else {
    btnDownload.disabled = true;
    btnDownload.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Building ZIP…';
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const { path, blob } of pendingBlobs) zip.file(path, blob);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    download(URL.createObjectURL(zipBlob), 'stripped-photos.zip');
    btnDownload.disabled = false;
    btnDownload.innerHTML = `${iconSvg('arrow-down-tray', 'w-4 h-4', '1.5')} Save ZIP`;
  }
  window.dispatchEvent(new CustomEvent('stripmeta:downloaded'));
});

let copyResultBusy = false;
btnCopyResult.addEventListener('click', async () => {
  if (copyResultBusy || !pendingBlobs.length) return;
  const { blob } = pendingBlobs[0]!;
  copyResultBusy = true;
  btnCopyResult.disabled = true;
  const originalHtml = btnCopyResult.innerHTML;
  btnCopyResult.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Copying…';
  try {
    let clipBlob: Blob;
    if (blob.type === 'image/png') {
      clipBlob = blob;
    } else {
      const bmp = await createImageBitmap(blob);
      const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      canvas.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      clipBlob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipBlob })]);
    btnCopyResult.innerHTML = `${iconSvg('check', 'w-4 h-4', '2.5')} Copied!`;
    window.dispatchEvent(new CustomEvent('stripmeta:copied'));
  } catch (err) {
    console.error('[copy]', err);
    btnCopyResult.innerHTML = `${iconSvg('x-mark', 'w-4 h-4', '2.5')} Failed`;
    setTimeout(() => {
      btnCopyResult.innerHTML = originalHtml;
      btnCopyResult.disabled = false;
      copyResultBusy = false;
    }, 4000);
    return;
  }
  setTimeout(() => {
    btnCopyResult.innerHTML = originalHtml;
    btnCopyResult.disabled = false;
    copyResultBusy = false;
  }, 2000);
});

onSettingChange('paranoid', () => {
  // Strip algorithm changed — cached blobs are stale.
  state.invalidate();
  pendingBlobs = [];
  for (const btn of copyBtnOf.values()) btn.hidden = true;
  render();
});

function maybeRestoreStripButton() {
  const hasUndone = entries.some(e => getSkipReason(e.file) === null && !state.done.has(e.file));
  if (hasUndone && !btnDownload.hidden) {
    btnDownload.hidden = true;
    btnStrip.hidden = false;
    pendingBlobs = [];
  }
}

onSettingChange('skipClean',        () => { for (const e of entries) applySkipStatus(e.file); syncFlatList(); updateAllDirCounts(); maybeRestoreStripButton(); });
onSettingChange('skipUnsupported',  () => { for (const e of entries) applySkipStatus(e.file); syncFlatList(); updateAllDirCounts(); maybeRestoreStripButton(); });
onSettingChange('skipExperimental', () => { for (const e of entries) applySkipStatus(e.file); syncFlatList(); updateAllDirCounts(); renderBanner(); maybeRestoreStripButton(); });

window.addEventListener('beforeunload', e => {
  if (settings.warnUnload && entries.length > 0) e.preventDefault();
});

// — Floating action buttons —

function makeFabSvg(d: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('w-4', 'h-4');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

const fabContainer = document.createElement('div');
fabContainer.className = 'fixed bottom-6 right-4 z-50 flex flex-col gap-2';
document.body.appendChild(fabContainer);

function makeFab(tip: string, icon: SVGSVGElement, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'flex items-center justify-center w-8 h-8 text-base-content/70 bg-base-100/70 backdrop-blur-sm border border-base-300 rounded-lg cursor-pointer hover:text-base-content hover:bg-base-200/80 tooltip tooltip-left transition-all duration-150 glass-elem';
  btn.setAttribute('data-tip', tip);
  btn.style.opacity = '0';
  btn.style.pointerEvents = 'none';
  btn.addEventListener('click', onClick);
  btn.appendChild(icon);
  fabContainer.appendChild(btn);
  return btn;
}

function collapseAll() {
  for (const wrap of dirRowOf.values()) {
    const children = wrap.children[1] as HTMLElement | undefined;
    const chevron  = (wrap.children[0] as HTMLElement)?.children[0] as HTMLElement | undefined;
    if (children && !children.hidden) {
      children.hidden = true;
      if (chevron) chevron.style.transform = '';
    }
  }
  updateFabs();
}

const fabTop     = makeFab('Scroll to top',    makeFabSvg('M5 15l7-7 7 7'),         () => window.scrollTo({ top: 0, behavior: 'smooth' }));
const fabBottom  = makeFab('Scroll to bottom', makeFabSvg('M19 9l-7 7-7-7'),        () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
const fabCollapse = makeFab('Collapse all',    makeFabSvg('M4 6h16M6 12h12M8 18h8'), collapseAll);

function setFabVisible(btn: HTMLButtonElement, visible: boolean) {
  btn.style.opacity = visible ? '1' : '0';
  btn.style.pointerEvents = visible ? 'auto' : 'none';
}

function updateFabs() {
  const scrollY    = window.scrollY;
  const maxScroll  = document.body.scrollHeight - window.innerHeight;
  const hasDirs    = dirRowOf.size > 0;
  const hasExpanded = hasDirs && [...dirRowOf.values()].some(w => !(w.children[1] as HTMLElement)?.hidden);

  setFabVisible(fabTop,      scrollY > 200);
  setFabVisible(fabBottom,   hasDirs && maxScroll > 50 && scrollY < maxScroll - 50);
  setFabVisible(fabCollapse, hasExpanded);
}

window.addEventListener('scroll', updateFabs, { passive: true });

initSettings();
