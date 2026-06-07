import { readMetadata, defaultStripperManager, paranoidStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel, MetadataPreview, StripperManager } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';
import { getSkipReason as _getSkipReason } from '../lib/skip.ts';
import { openMetadataModal } from './modal.ts';
import { settings, onSettingChange, collapseSettings, initSettings } from './settings.ts';
import { logEntry, clearLog, getLog, onLogChange, humanizeError } from './logger.ts';

const hero        = document.getElementById('hero') as HTMLElement;
const dropZone    = document.getElementById('drop-zone')!;
const fileInput   = document.getElementById('file-input') as HTMLInputElement;
const dirInput    = document.getElementById('dir-input') as HTMLInputElement;
const btnPickFiles = document.getElementById('btn-pick-files') as HTMLButtonElement;
const btnPickDir  = document.getElementById('btn-pick-dir') as HTMLButtonElement;
const fileList    = document.getElementById('file-list')!;
const fileWarningBanner = document.getElementById('file-warning-banner')!;
const actions     = document.getElementById('actions')!;
const btnStrip    = document.getElementById('btn-strip') as HTMLButtonElement;
const btnClear    = document.getElementById('btn-clear') as HTMLButtonElement;
const dropZoneContent = document.getElementById('drop-zone-content')!;
const scanStateEl   = document.getElementById('scan-state')!;
const scanCountEl   = document.getElementById('scan-count')!;
const logSection    = document.getElementById('log-section')!;
const btnLogToggle  = document.getElementById('btn-log-toggle') as HTMLButtonElement;
const logPanel      = document.getElementById('log-panel')!;
const logEntriesEl  = document.getElementById('log-entries')!;
const btnClearLog   = document.getElementById('btn-clear-log') as HTMLButtonElement;
function setScanState(active: boolean, count = 0) {
  dropZoneContent.classList.toggle('hidden', active);
  scanStateEl.classList.toggle('hidden', !active);
  scanStateEl.classList.toggle('flex', active);
  scanCountEl.textContent = active && count > 0
    ? `${count} image${count !== 1 ? 's' : ''} found so far…`
    : '';
}

function activeManager(): StripperManager {
  return settings.paranoid ? paranoidStripperManager : defaultStripperManager;
}

const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, none: 2 };


// — Data model —

interface FileEntry {
  file: File;
  path: string; // relative path e.g. "vacation/beach/photo.jpg" or just "photo.jpg"
}

interface DirNode {
  name: string;
  path: string;
  subdirs: Map<string, DirNode>;
  files: FileEntry[];
}

let entries: FileEntry[] = [];
let levelOf      = new Map<File, WarningLevel>();
let metadataCache = new Map<File, MetadataPreview>();
let heroCollapsed = false;

// DOM tracking
const rowOf       = new Map<File, HTMLElement>();
const urlOf       = new Map<File, string>();
const dirRowOf    = new Map<string, HTMLElement>();
const dirCounters = new Map<string, () => void>(); // path → update fn for the stat label

// — Directory breadcrumb

const dirBreadcrumb = document.createElement('div');
dirBreadcrumb.className = 'fixed z-50 px-3 py-1.5 text-sm text-base-content/80 bg-base-100/70 backdrop-blur-sm border border-base-300 rounded-xl transition-opacity duration-150 glass-elem';
dirBreadcrumb.style.cssText = 'top: 8px; left: 50%; transform: translateX(-50%); width: min(calc(100% - 2rem), 48rem); opacity: 0; pointer-events: none;';
document.body.appendChild(dirBreadcrumb);

window.addEventListener('scroll', () => {
  if (dirRowOf.size === 0) { dirBreadcrumb.style.opacity = '0'; dirBreadcrumb.style.pointerEvents = 'none'; return; }
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

// — Tree building —

function buildTree(allEntries: FileEntry[]): DirNode {
  const root: DirNode = { name: '', path: '', subdirs: new Map(), files: [] };
  for (const entry of allEntries) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      if (!node.subdirs.has(seg)) {
        const p = node.path ? `${node.path}/${seg}` : seg;
        node.subdirs.set(seg, { name: seg, path: p, subdirs: new Map(), files: [] });
      }
      node = node.subdirs.get(seg)!;
    }
    node.files.push(entry);
  }
  return root;
}


// — File removal —

function detachEntry(entry: FileEntry) {
  const url = urlOf.get(entry.file);
  if (url) URL.revokeObjectURL(url);
  urlOf.delete(entry.file);
  metadataCache.delete(entry.file);
  levelOf.delete(entry.file);
  rowOf.delete(entry.file);
  entries = entries.filter(e => e !== entry);
}

function afterRemove() {
  collapseSettings();
  if (entries.length === 0) {
    fileList.classList.add('hidden');
    actions.classList.add('hidden');
    logSection.classList.add('hidden');
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
    if (reason === 'lossy')            statusBadge.textContent = 'Skipped — lossy only';
    else if (reason === 'no-metadata') statusBadge.textContent = 'Skipped — no metadata';
    else                               statusBadge.textContent = 'Ready';
  }
}

// — Badge helper —

function badge(cls: string, text: string, tip?: string, tipDir = 'tooltip-right'): HTMLElement {
  const el = document.createElement('span');
  el.className = `badge badge-xs [--size:1.25rem] cursor-default ${cls}${tip ? ` tooltip ${tipDir}` : ''}`;
  el.textContent = text;
  if (tip) el.dataset.tip = tip;
  return el;
}

// — File card (preserved from original) —

function renderFileCard(entry: FileEntry, level: WarningLevel): HTMLElement {
  const { file } = entry;
  const row = document.createElement('div');
  row.className = 'card card-bordered bg-base-200 shadow-none transition-opacity relative overflow-hidden';
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

  const left = document.createElement('div');
  left.className = 'flex-1 min-w-0 space-y-1.5';

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
  statusBadge.className = 'badge badge-outline badge-sm status-badge';
  statusBadge.textContent = 'Ready';
  topRow.appendChild(statusBadge);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-ghost btn-xs btn-circle -mr-1 text-error/80 hover:text-error-content hover:bg-error';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => removeEntry(entry));
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
  }).catch(() => {});

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

    void (async () => {
      try {
        const preview = await readMetadata(file);

        if (preview.gps) {
          badgesSlot.appendChild(badge('badge-error', '📍 GPS', formatGps(preview.gps.latitude, preview.gps.longitude)));
        }
        if (preview.make || preview.model) {
          const cam = [preview.make, preview.model].filter(Boolean).join(' ');
          badgesSlot.appendChild(badge('badge-neutral max-w-[9rem] truncate', '📷 ' + cam, cam));
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
          badgesSlot.appendChild(badge('badge-neutral max-w-[9rem] truncate', '🛠️ ' + preview.software, preview.software));
        }
        if (preview.artist) {
          badgesSlot.appendChild(badge('badge-error max-w-[9rem] truncate', '👤 ' + preview.artist, preview.artist));
        }
        if (preview.userComment) {
          badgesSlot.appendChild(badge('badge-warning', '💬 Comment', preview.userComment));
        }

        metadataCache.set(file, preview);

        const hasMetadata = !!(preview.gps || preview.make || preview.model || preview.serialNumber
          || preview.dateTime || preview.software || preview.artist || preview.userComment);
        if (!hasMetadata) detailsBtn.textContent = 'no metadata';

        applySkipStatus(file);
        syncFlatList();
        updateAllDirCounts();
      } catch (err) {
        logEntry({ level: 'warning', fileName: file.name, filePath: entry.path, message: 'Could not read metadata: ' + humanizeError(err) });
      }
    })();
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

  function updateCount() {
    const under = entriesUnder(node.path);
    const n = under.length;
    const skipped = under.filter(e => getSkipReason(e.file) !== null).length;
    const ready = n - skipped;
    let stat = `${n} file${n !== 1 ? 's' : ''}`;
    if (n > 0 && levelOf.size > 0) {
      if (skipped === 0)    stat += ' · all ready';
      else if (ready === 0) stat += ' · all skipped';
      else                  stat += ` · ${ready} ready, ${skipped} skipped`;
    }
    countBadge.textContent = stat;
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

  header.append(chevron, label, countBadge, removeDir);

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
    renderDirRow(sub, true, container);
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
    rowOf.delete(entry.file);
  }
  entries = entries.filter(e => !allEntries.includes(e));
  const wrap = dirRowOf.get(node.path);
  wrap?.remove();
  dirRowOf.delete(node.path);
  afterRemove();
}

function collectEntries(node: DirNode): FileEntry[] {
  const result: FileEntry[] = [...node.files];
  for (const sub of node.subdirs.values()) result.push(...collectEntries(sub));
  return result;
}

// — Directory counts —

function entriesUnder(path: string): FileEntry[] {
  return entries.filter(e => e.path.startsWith(path + '/'));
}

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
  const lossy = levels.filter(l => l === 'lossy').length;
  const unsupported = levels.filter(l => l === 'unsupported').length;

  if (!lossy && !unsupported) { fileWarningBanner.hidden = true; fileWarningBanner.innerHTML = ''; return; }

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

  fileWarningBanner.hidden = false;
  fileWarningBanner.innerHTML = `<div class="alert alert-warning flex flex-col items-start gap-1 text-sm">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}

// — Main render —

async function render() {
  fileList.innerHTML = '';
  rowOf.clear();
  dirRowOf.clear();
  dirCounters.clear();

  const visible = entries.length > 0;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);
  logSection.classList.toggle('hidden', !visible);

  if (!visible) { fileWarningBanner.hidden = true; expandHero(); updateFabs(); return; }

  collapseHero();
  const levels = await Promise.all(entries.map(e => activeManager().classify(e.file)));
  levelOf = new Map(entries.map((e, i) => [e.file, levels[i]!]));

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

function addEntries(incoming: FileEntry[]) {
  const images = incoming.filter(e => e.file.type.startsWith('image/'));
  const existing = new Set(entries.map(e => e.file));
  const fresh = images.filter(e => !existing.has(e.file));
  entries = [...entries, ...fresh];
  collapseSettings();
  render();
}

function fromFileList(fileList: FileList | File[], getPath: (f: File) => string): FileEntry[] {
  return [...fileList].map(f => ({ file: f, path: getPath(f) }));
}

// — Strip & download —

async function stripAndDownload() {
  if (!entries.length) return;
  collapseSettings();
  btnStrip.disabled = true;
  btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Processing…';

  const blobs: { path: string; blob: Blob }[] = [];
  let hadErrors = false;

  await Promise.all(entries.map(async entry => {
    const { file, path } = entry;
    const statusBadge = rowOf.get(file)?.querySelector<HTMLElement>('.status-badge');

    if (getSkipReason(file) !== null) {
      if (settings.includeSkipped) {
        blobs.push({ path, blob: file });
        if (statusBadge) { statusBadge.textContent = 'Copied'; statusBadge.className = 'badge badge-outline badge-sm status-badge'; }
      } else {
        if (statusBadge) { statusBadge.textContent = 'Skipped'; statusBadge.className = 'badge badge-outline badge-sm status-badge'; }
      }
      return;
    }

    try {
      const blob = await activeManager().strip(file);
      blobs.push({ path, blob });
      if (statusBadge) { statusBadge.textContent = 'Done'; statusBadge.className = 'badge badge-success badge-sm status-badge'; }
    } catch (err) {
      hadErrors = true;
      if (statusBadge) { statusBadge.textContent = 'Error'; statusBadge.className = 'badge badge-error badge-sm status-badge'; }
      logEntry({ level: 'error', fileName: file.name, filePath: path, message: humanizeError(err) });
    }
  }));

  if (blobs.length === 1) {
    download(URL.createObjectURL(blobs[0]!.blob), blobs[0]!.path.split('/').at(-1) ?? blobs[0]!.path);
  } else if (blobs.length > 1) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const { path, blob } of blobs) zip.file(path, blob);
    download(URL.createObjectURL(await zip.generateAsync({ type: 'blob' })), 'stripped-photos.zip');
  }

  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata & download';

  if (blobs.length > 0 && !hadErrors) {
    try { window.dispatchEvent(new CustomEvent('stripmeta:processed')); } catch { /* ignore */ }
  }
}

function download(url: string, filename: string) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// — Event wiring —

btnPickFiles.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
btnPickDir.addEventListener('click',   e => { e.stopPropagation(); dirInput.click(); });
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
  metadataCache.clear();
  dirRowOf.clear();
  dirCounters.clear();
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

onSettingChange('paranoid',        () => render());
onSettingChange('skipClean',       () => { for (const e of entries) applySkipStatus(e.file); syncFlatList(); updateAllDirCounts(); });
onSettingChange('skipUnsupported', () => { for (const e of entries) applySkipStatus(e.file); syncFlatList(); updateAllDirCounts(); });

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
