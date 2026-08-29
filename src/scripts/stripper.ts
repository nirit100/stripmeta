import { readMetadata } from '../lib/metadata/read.ts';
import { defaultStripperManager, paranoidStripperManager } from '../lib/strippers/registry.ts';
import { browserCapabilities } from '../lib/platform/platform.ts';
import { iconSvg } from '../lib/view/icons.ts';
import { computeToProcess, collectBlobs } from '../lib/domain/stripPlan.ts';
import type { FileEntry } from '../lib/domain/stripPlan.ts';
import { buildTree, collectEntries, entriesUnder, findNode } from '../lib/domain/fileTree.ts';
import type { DirNode } from '../lib/domain/fileTree.ts';
import { FileStore } from '../lib/state/fileStore.ts';
import { ThumbUrls } from '../lib/state/thumbUrls.ts';
import type { WarningLevel } from '../lib/strippers/types.ts';
import type { StripperManager } from '../lib/strippers/manager.ts';
import type { MetadataPreview } from '../lib/metadata/types.ts';
import { formatBytes } from '../lib/util/format.ts';
import { statusBadge } from '../lib/view/statusBadge.ts';
import { openMetadataModal } from './modal.ts';
import { openLightbox } from './lightbox.ts';
import { settings, onSettingChange } from '../lib/state/settings.ts';
import { collapseSettings, initSettings } from './settings.ts';
import { logEntry, clearLog, getLog, onLogChange, humanizeError } from '../lib/state/logger.ts';
import { registerErroredFile, clearErroredFiles } from '../lib/state/erroredFiles.ts';
import { pooled, Semaphore } from '../lib/util/concurrency.ts';
import { copyImageToClipboard, copyFailLabel } from './clipboard.ts';
import { showGpsPopover } from './gpsPopover.ts';
import { bindTooltip, type TooltipDir } from './tooltip.ts';
import { splitFilename } from '../lib/util/filename.ts';
import { buildPreviewBadges } from '../lib/view/previewBadges.ts';
import { computeBannerLines } from '../lib/view/banner.ts';
import { formatDirStat, dirStatusDot, isDirDimmed } from '../lib/domain/dirStats.ts';
import { looksLikeImage } from '../lib/domain/ingest.ts';
import { detectFormat } from '../lib/format/detect.ts';

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
const zipHelpHint    = document.getElementById('zip-help-hint') as HTMLElement;
const dropZoneContent = document.getElementById('drop-zone-content')!;
const scanStateEl   = document.getElementById('scan-state')!;
const scanCountEl   = document.getElementById('scan-count')!;
const logSection    = document.getElementById('log-section')!;
const btnLogToggle  = document.getElementById('btn-log-toggle') as HTMLButtonElement;
const logPanel      = document.getElementById('log-panel')!;
const logEntriesEl  = document.getElementById('log-entries')!;
const btnClearLog       = document.getElementById('btn-clear-log') as HTMLButtonElement;
/** Absent unless the bug report is enabled for this build. */
const btnLogBugReport   = document.getElementById('btn-log-bug-report');
const stripProgressEl   = document.getElementById('strip-progress') as HTMLElement;
const fileListHeader    = document.getElementById('file-list-header')!;
const fileCountEl       = document.getElementById('file-count')!;
const fileListArea      = document.getElementById('file-list-area')!;

function updateFileListHeader() {
  const n = store.size;
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

// zipHelpHint is a sibling of #actions, not nested inside it, so hiding
// #actions alone (e.g. when the file list becomes empty) doesn't hide it too.
// Route every reset through here instead of repeating the pair inline, so a
// stray pendingBlobs/download reset can't leave it dangling.
function hideDownloadUI(): void {
  btnDownload.hidden = true;
  zipHelpHint.classList.add('hidden');
}

function activeManager(): StripperManager {
  return settings.paranoid ? paranoidStripperManager : defaultStripperManager;
}

// — Data model —

// Limits concurrent exifr parses to avoid OOM on mobile. Metadata reads fire
// per card as cards render (and lazily as directories expand), so this gates an
// open-ended stream rather than a fixed batch — hence a semaphore, not pooled().
const metaSem = new Semaphore(6);

const store = new FileStore();
let heroCollapsed = false;
let renderGen = 0;
let pendingBlobs: { path: string; blob: Blob }[] = [];
// Switches skip badges from the reason ("Skipped — lossy only") to the outcome
// ("Skipped"). Cleared whenever the run's results stop describing the list:
// files added, list cleared, or strip results invalidated.
let hasRunStrip = false;

// DOM tracking
const rowOf          = new Map<File, HTMLElement>();
const thumbUrls      = new ThumbUrls();
const dirRowOf       = new Map<string, HTMLElement>();
const dirChildrenOf  = new Map<string, HTMLElement>(); // path -> children container
const dirMaterialised = new Set<string>();             // paths whose children have been built
const dirCounters    = new Map<string, () => void>(); // path -> update fn for the stat label
const dirExpanders   = new Map<string, () => void>(); // path -> expand fn (for reveal-in-list)
const copyBtnOf      = new Map<File, HTMLButtonElement>();

// The tree as last rendered. Dir rows outlive any one build of it, so they hold
// a path and look themselves up here rather than capturing a node.
let currentTree: DirNode = buildTree([]);

// — Directory breadcrumb

const dirBreadcrumb = document.createElement('div');
dirBreadcrumb.className = 'fixed z-50 px-3 py-1.5 text-sm text-base-content/80 bg-base-100/70 backdrop-blur-sm border border-base-300 rounded-xl transition-opacity duration-150 glass-elem';
dirBreadcrumb.style.cssText = 'top: 8px; left: 50%; transform: translateX(-50%); width: min(calc(100% - 2rem), 48rem); opacity: 0; pointer-events: none;';
document.body.appendChild(dirBreadcrumb);

window.addEventListener('scroll', () => {
  if (dirRowOf.size === 0) { dirBreadcrumb.style.opacity = '0'; dirBreadcrumb.style.pointerEvents = 'none'; return; }

  const CRUMB_BOTTOM = dirBreadcrumb.offsetHeight + 16; // breadcrumb height + margin
  const headerTops = new Map<string, number>();
  for (const [path, wrap] of dirRowOf) {
    const header = wrap.firstElementChild as HTMLElement;
    // Skip headers nested inside a collapsed ancestor — they're display:none,
    // so their rect collapses to all-zero and would be mistaken for "at the top".
    if (header.offsetParent === null) continue;
    headerTops.set(path, header.getBoundingClientRect().top);
  }

  // Hide while a dir header is passing through the breadcrumb's own area —
  // the real header is visible right there, so the breadcrumb would be redundant.
  for (const headerTop of headerTops.values()) {
    if (headerTop >= 0 && headerTop < CRUMB_BOTTOM) {
      dirBreadcrumb.style.opacity = '0';
      dirBreadcrumb.style.pointerEvents = 'none';
      return;
    }
  }

  // Otherwise show whichever header most recently scrolled past the top —
  // document order means that's always the innermost dir we're currently inside.
  let best = '';
  let bestTop = -Infinity;
  for (const [path, headerTop] of headerTops) {
    if (headerTop < 0 && headerTop > bestTop) { bestTop = headerTop; best = path; }
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

  // Something went wrong, so nudge the way to say so — the panel is collapsed
  // when the log first fills, and the pulse repeats until it is cleared.
  btnLogBugReport?.classList.toggle('bug-nudge', errors + warnings > 0);
  btnLogBugReport?.classList.toggle('bug-nudge-error', errors > 0);

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
  thumbUrls.release(entry.file);
  rowOf.delete(entry.file);
  copyBtnOf.delete(entry.file);
  store.remove(entry); // drops the entry, its model, and its strip state
}

function afterRemove() {
  collapseSettings();
  updateFileListHeader();
  if (store.isEmpty) {
    fileList.classList.add('hidden');
    actions.classList.add('hidden');
    logSection.classList.add('hidden');
    stripProgressEl.classList.add('hidden');
    fileWarningBanner.hidden = true;
    hideDownloadUI();
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

/**
 * Drops a directory and its descendants from the dir-row bookkeeping. Leaving a
 * stale path behind would make a later row at the same path look already
 * materialised, so it would never build its children.
 */
function forgetDir(path: string): void {
  const prefix = path + '/';
  for (const key of [...dirRowOf.keys()]) {
    if (key !== path && !key.startsWith(prefix)) continue;
    dirRowOf.delete(key);
    dirChildrenOf.delete(key);
    dirMaterialised.delete(key);
    dirCounters.delete(key);
    dirExpanders.delete(key);
  }
}

function cleanEmptyDirs() {
  for (const [path, dirRow] of [...dirRowOf]) {
    if (entriesUnder(store.entries, path).length === 0) { dirRow.remove(); forgetDir(path); }
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
  return store.skipReason(file, settings);
}

/** Repaints a file's status badge from store state. The only writer of `.status-badge`. */
function paintStatus(file: File) {
  const row = rowOf.get(file);
  const el = row?.querySelector<HTMLElement>('.status-badge');
  if (!row || !el) return;
  const { hidden, text, cls, dimmed } = statusBadge({
    done:           store.strip.done.has(file),
    errored:        store.strip.errored.has(file),
    skipReason:     getSkipReason(file),
    includeSkipped: settings.includeSkipped,
    stripped:       hasRunStrip,
  });
  el.hidden = hidden;
  el.textContent = text;
  el.className = cls;
  row.classList.toggle('opacity-40', dimmed);
}

// — File card handler constants —

const COPY_BTN_CLASS = 'btn btn-ghost btn-xs btn-circle text-base-content/65 hover:text-primary hover:bg-primary/10 tooltip tooltip-left transition-colors';
const SVG_COPY_CLIP  = iconSvg('clipboard', 'w-3.5 h-3.5', '2');
const SVG_COPY_CHECK = iconSvg('check',     'w-3.5 h-3.5', '2.5');
const SVG_COPY_X     = iconSvg('x-mark',   'w-3.5 h-3.5', '2.5');

// — Badge helper —

function badge(cls: string, text: string, tip?: string, tipDir: TooltipDir = 'top'): HTMLElement {
  const el = document.createElement('span');
  el.className = `badge badge-xs [--size:1.25rem] cursor-default ${cls}`;
  if (tip) {
    el.dataset.tip = tip;
    bindTooltip(el, tipDir);
  }
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
    const blob = store.strip.blobs.get(file);
    if (!blob) return;
    busy = true;
    copyBtn.disabled = true;
    copyBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
    try {
      await copyImageToClipboard(blob);
      copyBtn.innerHTML = SVG_COPY_CHECK;
      copyBtn.className = 'btn btn-ghost btn-xs btn-circle text-success tooltip tooltip-left transition-colors';
      copyBtn.dataset.tip = 'Copied!';
      window.dispatchEvent(new CustomEvent('stripmeta:copied'));
    } catch (err) {
      console.error('[copy]', err);
      copyBtn.innerHTML = SVG_COPY_X;
      copyBtn.className = 'btn btn-ghost btn-xs btn-circle text-error tooltip tooltip-left transition-colors';
      copyBtn.dataset.tip = copyFailLabel(err);
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

function renderPreviewBadges(preview: MetadataPreview, badgesSlot: HTMLElement): void {
  for (const b of buildPreviewBadges(preview)) {
    if (b.kind === 'gps') {
      const gpsBadge = document.createElement('button');
      gpsBadge.type = 'button';
      gpsBadge.className = 'badge badge-xs badge-error [--size:1.25rem] cursor-pointer tooltip tooltip-top';
      gpsBadge.dataset.tip = b.coord;
      const gpsInner = document.createElement('span');
      gpsInner.className = 'truncate min-w-0';
      gpsInner.textContent = '📍 GPS';
      gpsBadge.appendChild(gpsInner);
      gpsBadge.addEventListener('click', e => {
        e.stopPropagation();
        showGpsPopover(gpsBadge, b.lat, b.lon, b.coord);
      });
      badgesSlot.appendChild(gpsBadge);
    } else {
      badgesSlot.appendChild(badge(b.cls, b.text, b.tip));
    }
  }
}

async function loadFileMetadata(entry: FileEntry, badgesSlot: HTMLElement, detailsBtn: HTMLButtonElement): Promise<void> {
  const { file } = entry;
  const gen = renderGen;

  // The store keeps previews across re-classification, so a re-rendered card
  // reuses the read instead of parsing the file again.
  let preview = store.preview(file);
  if (!preview) {
    try {
      await metaSem.acquire();
      try {
        preview = await readMetadata(file);
      } finally {
        metaSem.release();
      }
    } catch (err) {
      logEntry({ level: 'warning', fileName: file.name, filePath: entry.path, message: 'Could not read metadata: ' + humanizeError(err) });
      return;
    }
    store.setPreview(file, preview);
    if (preview.parseErrored && getSkipReason(file) === null) {
      logEntry({ level: 'warning', fileName: file.name, filePath: entry.path, message: 'Could not read metadata' });
    }
    if (preview.formatUndetected) {
      logEntry({
        level: 'warning', fileName: file.name, filePath: entry.path,
        message: `Could not identify this file's format from its contents — fell back to the type the browser reported (${file.type || 'none'}). Please report this file so the detection can be fixed.`,
      });
    }
  }

  // A newer render owns the list now; it will pick the preview up from the store.
  if (gen !== renderGen) return;

  renderPreviewBadges(preview, badgesSlot);
  if (!preview.hasAnyMetadata && !preview.parseErrored) detailsBtn.textContent = 'no metadata';

  paintStatus(file);
  syncFlatList();
  updateAllDirCounts();
}

// — File card —

/** The card thumbnail: a decoded preview when enabled, or an icon placeholder that never decodes the file. */
function makeThumb(file: File): HTMLElement {
  let thumb: HTMLElement;
  if (settings.showPreviews) {
    const objUrl = thumbUrls.create(file);
    const img = document.createElement('img');
    img.className = 'file-thumb w-12 h-12 rounded object-cover shrink-0 bg-base-300';
    img.src = objUrl;
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    thumb = img;
  } else {
    const ph = document.createElement('div');
    ph.className = 'file-thumb w-12 h-12 rounded shrink-0 bg-base-300 flex items-center justify-center text-base-content/30';
    ph.innerHTML = iconSvg('eye-slash', 'w-5 h-5', '1.5');
    thumb = ph;
  }
  // Tapping any thumbnail opens the full-screen viewer. With previews off the file
  // isn't decoded until this click — an explicit, on-demand action, not bulk decoding.
  thumb.classList.add('cursor-zoom-in');
  thumb.setAttribute('role', 'button');
  thumb.setAttribute('aria-label', `Open preview of ${file.name}`);
  thumb.title = 'Open preview';
  thumb.addEventListener('click', () =>
    openLightbox(file, navEntries(), {
      onReveal: revealFile,
      onShowMetadata: f => openMetadataModal(f, activeManager()),
      resolveUrl: f => thumbUrls.get(f),
    }));
  return thumb;
}

// — Card shine —
//
// Cards are built in document order, so a card's position in the batch is its
// position down the page. Staggering by that index makes a folder sweep in
// sequence instead of flashing all at once.
// Kept small: the skew angle on the strip is chosen to match this slope, so
// changing one without the other breaks the illusion of a single wavefront.
const SHINE_STEP_MS = 20;
// Past this the cascade is longer than anyone waits, and the cards that far
// down are off screen anyway, so they all share the last slot.
const SHINE_MAX_DELAY_MS = 300;

let shineIndex = 0;

/** Starts a new stagger sequence. Called once per batch of cards. */
function beginShineBatch(): void {
  shineIndex = 0;
}

function startShine(row: HTMLElement): void {
  row.style.setProperty('--shine-delay', `${Math.min(shineIndex++ * SHINE_STEP_MS, SHINE_MAX_DELAY_MS)}ms`);

  // Drop the class once it has played. A collapsed folder's children are
  // display:none, and re-showing them restarts any animation still attached,
  // which is why the shine used to replay on every expand.
  const done = (e: AnimationEvent) => {
    if (e.animationName !== 'card-shine') return;
    row.classList.remove('card-new');
    row.style.removeProperty('--shine-delay');
    row.removeEventListener('animationend', done);
  };
  row.addEventListener('animationend', done);
}

function renderFileCard(entry: FileEntry, level: WarningLevel): HTMLElement {
  const { file } = entry;
  const row = document.createElement('div');
  const noGlass = document.documentElement.classList.contains('no-glass');
  row.className = `card card-bordered bg-base-200 shadow-none transition-opacity relative overflow-hidden${noGlass ? '' : ' card-new'}`;
  row.dataset.type = file.type;
  rowOf.set(file, row);
  if (!noGlass) startShine(row);

  const deleteHint = document.createElement('div');
  deleteHint.className = 'delete-hint absolute inset-y-0 right-0 flex items-center gap-2 px-6 bg-error text-error-content text-sm font-semibold pointer-events-none select-none opacity-0';
  deleteHint.textContent = '✕ Remove';
  row.appendChild(deleteHint);

  const body = document.createElement('div');
  body.className = 'card-body p-4 flex-row items-start gap-3 bg-base-200 relative';

  const thumb = makeThumb(file);

  const left = document.createElement('div');
  left.className = 'flex-1 min-w-0 self-stretch flex flex-col justify-between';

  const nameEl = document.createElement('div');
  nameEl.className = 'text-sm font-medium leading-snug flex min-w-0';

  const { head, tail } = splitFilename(file.name);

  const nameHead = document.createElement('span');
  nameHead.className = 'truncate min-w-0';
  nameHead.textContent = head;

  const nameTail = document.createElement('span');
  nameTail.className = 'shrink-0 whitespace-nowrap';
  nameTail.textContent = tail;

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
    topRow.appendChild(badge('badge-error badge-sm', '✕ Unsupported', 'Cannot be decoded in this browser — stripping will fail', 'left'));
  }

  // Painted by paintStatus() at the end of this function, once the badge is in the row.
  const statusBadgeEl = document.createElement('span');
  statusBadgeEl.className = 'badge badge-outline badge-sm status-badge';
  topRow.appendChild(statusBadgeEl);

  if (level !== 'unsupported' && store.canConvertPng(file) && !!navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = COPY_BTN_CLASS;
    const defaultTip = file.type === 'image/png' ? 'Copy to clipboard' : 'Copy as PNG';
    copyBtn.dataset.tip = defaultTip;
    copyBtn.innerHTML = SVG_COPY_CLIP;
    copyBtn.hidden = !store.strip.done.has(file);
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
      lossyLabel.className = 'text-xs text-warning cursor-default';
      lossyLabel.textContent = '⚠️ Lossy';
      lossyLabel.dataset.tip = 'Output will be re-encoded as JPEG (small quality loss)';
      bindTooltip(lossyLabel, 'left');
      handlerRow.appendChild(lossyLabel);
    }
    if (h.experimental) {
      handlerRow.appendChild(badge(
        'badge-warning badge-outline badge-xs',
        'Experimental',
        'Metadata stripping for this format is new — some files may fail',
        'left',
      ));
    }
  }).catch(err => console.warn('[handler resolve]', err));

  paintStatus(file);

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
  wrap.dataset.dir = node.path;
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
    const stats = store.dirStats(node.path, settings);
    const hasLevels = store.classified;

    countBadge.textContent = formatDirStat(stats, hasLevels);

    // Status dot: green = something done, red = any errors, hidden = not run or all skipped
    const dot = dirStatusDot(stats);
    statusDot.className = dot === 'error'
      ? 'w-2 h-2 rounded-full shrink-0 bg-error'
      : dot === 'done'
        ? 'w-2 h-2 rounded-full shrink-0 bg-success'
        : 'w-2 h-2 rounded-full shrink-0 hidden';

    // Dim the row if no files are ready to strip
    wrap.style.opacity = isDirDimmed(stats, hasLevels) ? '0.45' : '';
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
  dirChildrenOf.set(node.path, children);

  function expand() {
    chevron.style.transform = 'rotate(90deg)';
    if (!dirMaterialised.has(node.path)) {
      dirMaterialised.add(node.path);
      // Look the node up afresh: `node` is from the tree as it stood when this
      // row was built, and files may have been added to this directory since.
      const current = findNode(currentTree, node.path);
      if (current) {
        beginShineBatch();
        syncDirContents(current, children, false);
      }
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
  dirExpanders.set(node.path, expand);

  wrap.append(header, children);
  container.appendChild(wrap);

  if (defaultExpanded) expand();

  return wrap;
}

/**
 * Materialises everything in `node` that isn't on screen yet, leaving existing
 * cards and dir rows — and their expansion state — untouched. Idempotent, so
 * the full render and an incremental add share one walk.
 *
 * Files render before subdirs, matching collectEntries so lightbox prev/next
 * follows the order the user sees; new cards are therefore inserted ahead of
 * the first dir row rather than appended after it.
 */
function syncDirContents(node: DirNode, container: HTMLElement, defaultExpanded: boolean): void {
  const firstDirRow = container.querySelector<HTMLElement>(':scope > [data-dir]');
  for (const entry of node.files) {
    if (rowOf.has(entry.file)) continue;
    const card = renderFileCard(entry, store.level(entry.file) ?? 'none');
    container.insertBefore(card, firstDirRow); // insertBefore(_, null) appends
  }
  for (const sub of node.subdirs.values()) {
    if (!dirRowOf.has(sub.path)) {
      renderDirRow(sub, defaultExpanded, container);
    } else if (dirMaterialised.has(sub.path)) {
      // Anything found deeper is nested, and nested rows start collapsed —
      // defaultExpanded only ever applies at the top level.
      syncDirContents(sub, dirChildrenOf.get(sub.path)!, false);
    }
  }
}

function removeDirNode(node: DirNode) {
  const allEntries = collectEntries(node);
  for (const entry of allEntries) {
    thumbUrls.release(entry.file);
    rowOf.delete(entry.file);
  }
  store.removeFiles(allEntries.map(e => e.file));
  const wrap = dirRowOf.get(node.path);
  wrap?.remove();
  forgetDir(node.path);
  afterRemove();
}

// — Lightbox integration —

/** All files in render/visual order (files-then-subdirs DFS) — the prev/next set. */
function navEntries(): FileEntry[] {
  return collectEntries(buildTree(store.entries));
}

/**
 * Smoothly scroll the window to `targetY`, animated by us rather than the
 * browser. Native smooth `scrollIntoView`/`scrollTo` is unreliable on some
 * engines (notably Firefox Android, which silently no-ops it), so we drive the
 * scroll frame-by-frame for identical behaviour everywhere. Re-asserting the
 * position each frame also overrides a one-off focus-restoration scroll from the
 * closing dialog. Falls back to an instant jump under reduced-motion.
 */
function smoothScrollWindowTo(targetY: number): void {
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  const endY = Math.max(0, Math.min(targetY, maxY));
  const startY = window.scrollY;
  const dist = endY - startY;
  if (Math.abs(dist) < 1) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.classList.contains('no-glass');
  if (reduce) { window.scrollTo(0, endY); return; }

  const DURATION = 380;
  const start = performance.now();
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / DURATION);
    window.scrollTo(0, startY + dist * easeOutCubic(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Reveal a file in the list: expand its ancestor folders, scroll to its card, flash it. */
function revealFile(file: File): void {
  const entry = store.entries.find(e => e.file === file);
  if (!entry) return;
  // Expand each ancestor top-down (materialises lazily) so the card exists.
  const parts = entry.path.split('/');
  let prefix = '';
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]!;
    dirExpanders.get(prefix)?.();
  }
  // Two frames of deferral: one lets the expand above settle, the other lets
  // the dialog's own native focus-restoration scroll (which lands a frame
  // after close() returns and would otherwise cancel ours) happen first.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const row = rowOf.get(file);
    if (!row) return;
    // Centre the card in the viewport. getBoundingClientRect() forces a reflow,
    // so the position is accurate even though the folders just expanded.
    const rect = row.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
    smoothScrollWindowTo(targetY);
    // Let the scroll animation land before flashing (reveal-flash pulses 3x, 1.2s each).
    setTimeout(() => {
      row.classList.add('reveal-flash');
      setTimeout(() => row.classList.remove('reveal-flash'), 3600);
    }, 500);
  }));
}

// — Directory counts —

function updateAllDirCounts() {
  for (const update of dirCounters.values()) update();
}

// — Flat-mode sorting (only when no directory structure) —

function syncFlatList() {
  if (!store.isFlat()) return;
  const sorted = store.flatSorted(settings);
  for (const entry of sorted) {
    const row = rowOf.get(entry.file);
    if (row) fileList.appendChild(row); // reorder in-place
    paintStatus(entry.file);
  }
}

// — Banner —

function renderBanner() {
  const lines = computeBannerLines(store.bannerCounts(), settings);

  if (lines.length === 0) { fileWarningBanner.hidden = true; fileWarningBanner.innerHTML = ''; return; }

  fileWarningBanner.hidden = false;
  fileWarningBanner.innerHTML = `<div class="flex flex-col gap-1 text-sm px-4 py-3 rounded-xl border border-base-300 text-base-content/70">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}

// — Main render —

/** Classifies entries concurrently, keyed by file. */
function classifyEntries(entries: FileEntry[]) {
  return pooled(entries, 8, async e => {
    const level = await activeManager().classify(e.file);
    // Lossless (incl. experimental): output type = input type. Lossy (canvas): output is JPEG.
    const { mime } = await detectFormat(e.file);
    const canConvertPng = level === 'lossy'
      || mime === 'image/png'
      || (level !== 'unsupported' && await browserCapabilities.canDecodeImage(mime));
    return { level, canConvertPng };
  }).then(results => new Map(entries.map((e, i) => [e.file, results[i]!])));
}

/** Restores the action buttons after an analysis pass. */
function finishAnalysis() {
  renderBanner();
  hideDownloadUI();
  btnCopyResult.hidden = true;
  btnStrip.hidden = false;
  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata';
}

async function render() {
  const gen = ++renderGen;

  fileList.innerHTML = '';
  rowOf.clear();
  dirRowOf.clear();
  dirChildrenOf.clear();
  dirMaterialised.clear();
  dirCounters.clear();
  dirExpanders.clear();
  copyBtnOf.clear();

  const visible = !store.isEmpty;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);
  logSection.classList.toggle('hidden', !visible);
  updateFileListHeader();

  if (!visible) {
    currentTree = buildTree([]);
    fileWarningBanner.hidden = true;
    stripProgressEl.classList.add('hidden');
    hideDownloadUI();
    expandHero();
    updateFabs();
    return;
  }

  collapseHero();
  btnStrip.disabled = true;
  btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Analysing…';

  const classified = await classifyEntries(store.entries);

  // A newer render() call started while we were classifying — let it own the result.
  if (gen !== renderGen) return;

  store.setClassification(classified);

  currentTree = buildTree(store.entries);
  beginShineBatch();
  syncDirContents(currentTree, fileList, store.size <= 10);

  finishAnalysis();
}

/**
 * Adds already-stored entries to the list without rebuilding it: only the new
 * files are classified and only missing rows are created, so existing cards
 * keep their metadata badges, strip results, and expansion state.
 */
async function appendEntries(fresh: FileEntry[]) {
  const gen = renderGen;
  btnStrip.disabled = true;
  btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Analysing…';

  const classified = await classifyEntries(fresh);
  if (gen !== renderGen) return; // a full render took over

  store.mergeClassification(classified);

  currentTree = buildTree(store.entries);
  beginShineBatch();
  syncDirContents(currentTree, fileList, store.size <= 10);

  updateFileListHeader();
  updateAllDirCounts();
  syncFlatList();
  finishAnalysis();
}

// — Adding files —

/**
 * Walks a dropped entry, yielding the image files under it.
 *
 * `topLevel` marks the things the user actually dropped. Those are reported
 * when they turn out not to be images; files merely found while walking into a
 * folder are dropped quietly, since the user chose the folder, not them.
 */
async function* scanDirectoryEntry(entry: FileSystemEntry, topLevel = true): AsyncGenerator<FileEntry> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej));
    const path = entry.fullPath.replace(/^\//, '');
    if (looksLikeImage(file)) {
      yield { file, path };
    } else if (topLevel) {
      logEntry({ level: 'warning', fileName: file.name, filePath: path, message: 'Not recognised as an image — skipped' });
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const child of batch) yield* scanDirectoryEntry(child, false);
    } while (batch.length > 0);
  }
}

async function addEntries(incoming: FileEntry[]) {
  const wasEmpty = store.isEmpty;
  hasRunStrip = false;
  for (const e of incoming.filter(e => !looksLikeImage(e.file))) {
    logEntry({ level: 'warning', fileName: e.file.name, filePath: e.path, message: 'Not recognised as an image — skipped' });
  }
  const fresh = store.add(incoming.filter(e => looksLikeImage(e.file)));
  collapseSettings();
  // A first load has hero collapse and visibility toggles to do; afterwards only
  // the new entries need touching. Nothing fresh at all is a no-op.
  if (wasEmpty) await render();
  else if (fresh.length > 0) await appendEntries(fresh);
  if (wasEmpty && !store.isEmpty) {
    requestAnimationFrame(() => fileListArea.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function fromFileList(fileList: FileList | File[], getPath: (f: File) => string): FileEntry[] {
  return [...fileList].map(f => ({ file: f, path: getPath(f) }));
}

// — Strip & download —

/**
 * Re-derives the download set and the Save / Copy buttons from current state.
 * Every blob is already cached in the store, so this only reselects — nothing
 * is stripped again. Returns how many files the download would contain.
 */
async function refreshDownloadUI(): Promise<number> {
  const blobs = collectBlobs(store.entries, getSkipReason, store.strip.done, store.strip.blobs, settings.includeSkipped);
  pendingBlobs = blobs;

  if (blobs.length >= 1) {
    btnDownload.innerHTML = `${iconSvg('arrow-down-tray', 'w-4 h-4', '1.5')} ${blobs.length === 1 ? 'Save' : 'Save ZIP'}`;
    btnDownload.hidden = false;
    zipHelpHint.classList.toggle('hidden', blobs.length <= 1);
    btnStrip.hidden = true;
  } else {
    hideDownloadUI();
    btnStrip.hidden = false;
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

  return blobs.length;
}

async function stripAndDownload() {
  if (store.isEmpty) return;
  collapseSettings();

  // Preserve done state; clear only errors so they get retried.
  store.strip.resetErrors();
  clearErroredFiles();
  pendingBlobs = [];
  hideDownloadUI();

  const toProcess = computeToProcess(store.entries, getSkipReason, store.strip.done);

  // Per-run deltas — the 'processed' consumer adds these to the lifetime totals.
  const runStats = { filesProcessed: 0, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 };
  let hadErrors = false;

  if (toProcess.length > 0) {
    btnStrip.disabled = true;
    btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Processing…';
    stripProgressEl.classList.remove('hidden');
    let doneCount = 0;

    await pooled(toProcess, 3, async entry => {
      const { file, path } = entry;
      try {
        stripProgressEl.textContent = `${++doneCount} / ${toProcess.length} — ${file.name}`;
        const blob = await activeManager().strip(file);
        runStats.filesProcessed++;
        const preview = store.preview(file);
        if (preview?.gps)      runStats.gpsRemoved++;
        if (preview?.dateTime) runStats.datesRemoved++;
        runStats.bytesStripped += Math.max(0, file.size - blob.size);
        store.strip.markDone(file, blob);
        const copyBtn = copyBtnOf.get(file);
        if (copyBtn) copyBtn.hidden = false;
        paintStatus(file);
      } catch (err) {
        hadErrors = true;
        store.strip.markError(file);
        registerErroredFile(file, path);
        paintStatus(file);
        logEntry({ level: 'error', fileName: file.name, filePath: path, message: humanizeError(err) });
      }
    });
  }

  // Skip badges now report the outcome rather than the reason.
  hasRunStrip = true;
  for (const { file } of store.entries) paintStatus(file);

  const blobCount = await refreshDownloadUI();

  stripProgressEl.classList.add('hidden');
  stripProgressEl.textContent = '';
  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata';
  updateAllDirCounts();

  if (blobCount > 0) {
    try { window.dispatchEvent(new CustomEvent('stripmeta:processed', { detail: { ...runStats, hadErrors } })); } catch { /* ignore */ }
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
  thumbUrls.releaseAll();
  store.clear();
  dirRowOf.clear();
  dirCounters.clear();
  copyBtnOf.clear();
  pendingBlobs = [];
  hasRunStrip = false;
  hideDownloadUI();
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
    await copyImageToClipboard(blob);
    btnCopyResult.innerHTML = `${iconSvg('check', 'w-4 h-4', '2.5')} Copied!`;
    window.dispatchEvent(new CustomEvent('stripmeta:copied'));
  } catch (err) {
    console.error('[copy]', err);
    btnCopyResult.innerHTML = `${iconSvg('x-mark', 'w-4 h-4', '2.5')} ${copyFailLabel(err)}`;
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
  store.strip.invalidate();
  pendingBlobs = [];
  hasRunStrip = false;
  hideDownloadUI();
  for (const btn of copyBtnOf.values()) btn.hidden = true;
  render();
});

/**
 * Re-derives the action buttons after a setting changed which files are in
 * play. The cached download set was selected under the old settings, so it has
 * to be reselected — or dropped entirely if there is strippable work again.
 */
function refreshActions() {
  if (!hasRunStrip) return;
  if (store.hasPendingStrippable(settings)) {
    pendingBlobs = [];
    hideDownloadUI();
    btnCopyResult.hidden = true;
    btnStrip.hidden = false;
    return;
  }
  void refreshDownloadUI();
}

/** Every setting that feeds getSkipReason or the download selection lands here. */
function onSelectionSettingChanged() {
  for (const e of store.entries) paintStatus(e.file);
  syncFlatList();
  updateAllDirCounts();
  renderBanner();
  refreshActions();
}

onSettingChange('skipClean',        onSelectionSettingChanged);
onSettingChange('skipUnsupported',  onSelectionSettingChanged);
onSettingChange('skipExperimental', onSelectionSettingChanged);
onSettingChange('includeSkipped',   onSelectionSettingChanged);

onSettingChange('showPreviews', () => {
  // Swap thumbnails in place — no reclassification needed. Revoke any decoded
  // preview before replacing so toggling off frees its memory.
  for (const [file, row] of rowOf) {
    // Explicit: with previews off makeThumb builds a placeholder and never
    // calls create(), so nothing would release the decoded preview's URL.
    thumbUrls.release(file);
    row.querySelector('.file-thumb')?.replaceWith(makeThumb(file));
  }
});

window.addEventListener('beforeunload', e => {
  if (settings.warnUnload && !store.isEmpty) e.preventDefault();
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
