import { readMetadata, defaultStripperManager, paranoidStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel, MetadataPreview, StripperManager } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';
import { getSkipReason as _getSkipReason } from '../lib/skip.ts';
import { openMetadataModal } from './modal.ts';
import { initSettingsPanel } from './settings-panel.ts';

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
const toggleParanoid        = document.getElementById('toggle-paranoid') as HTMLInputElement;
const toggleSkipClean       = document.getElementById('toggle-skip-clean') as HTMLInputElement;
const toggleSkipUnsupported = document.getElementById('toggle-skip-unsupported') as HTMLInputElement;

const settings = {
  get paranoid()        { return toggleParanoid.checked; },
  get skipClean()       { return toggleSkipClean.checked; },
  get skipUnsupported() { return toggleSkipUnsupported.checked; },
};

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
  if (entries.length === 0) {
    fileList.classList.add('hidden');
    actions.classList.add('hidden');
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
  if (reason === 'unsupported')  statusBadge.textContent = 'Skipped — unsupported';
  else if (reason === 'lossy')   statusBadge.textContent = 'Skipped — no lossless handler';
  else if (reason === 'no-metadata') statusBadge.textContent = 'Skipped — no metadata';
  else statusBadge.textContent = 'Ready';
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
  nameEl.className = 'text-sm font-medium truncate leading-snug';
  nameEl.textContent = file.name;

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

    readMetadata(file).then(preview => {
      if (preview.gps)          badgesSlot.appendChild(badge('badge-error', '📍 GPS', formatGps(preview.gps.latitude, preview.gps.longitude)));
      if (preview.make || preview.model) {
        const cam = [preview.make, preview.model].filter(Boolean).join(' ');
        badgesSlot.appendChild(badge('badge-neutral max-w-[9rem] truncate', '📷 ' + cam, cam));
      }
      if (preview.serialNumber)  badgesSlot.appendChild(badge('badge-warning', 'S/N', preview.serialNumber));
      if (preview.dateTime) {
        const dateStr = String(preview.dateTime).slice(0, 10).replace(/:/g, '-');
        badgesSlot.appendChild(badge('badge-neutral font-mono', '📅 ' + dateStr));
      }
      if (preview.software)      badgesSlot.appendChild(badge('badge-neutral max-w-[9rem] truncate', '🛠️ ' + preview.software, preview.software));
      if (preview.artist)        badgesSlot.appendChild(badge('badge-error max-w-[9rem] truncate', '👤 ' + preview.artist, preview.artist));
      if (preview.userComment)   badgesSlot.appendChild(badge('badge-warning', '💬 Comment', preview.userComment));
      metadataCache.set(file, preview);
      if (!preview.gps && !preview.make && !preview.model && !preview.serialNumber &&
          !preview.dateTime && !preview.software && !preview.artist && !preview.userComment) {
        detailsBtn.textContent = 'no metadata';
      }
      applySkipStatus(file);
      syncFlatList();
      updateAllDirCounts();
    }).catch(() => {});
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

  const chevron = document.createElement('span');
  chevron.className = 'text-base-content/40 text-xs transition-transform duration-200 inline-block';
  chevron.textContent = '▶';

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
      if (skipped === 0)   stat += ' · all ready';
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
  children.className = 'flex flex-col gap-2 pl-4 mt-2';
  children.hidden = true;

  let materialised = false;

  function expand() {
    chevron.style.transform = 'rotate(90deg)';
    if (!materialised) {
      materialised = true;
      materialiseDir(node, children);
    }
    children.hidden = false;
  }
  function collapse() {
    chevron.style.transform = '';
    children.hidden = true;
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
  fileWarningBanner.innerHTML = `<div class="alert alert-soft alert-warning flex flex-col items-start gap-1 text-sm">${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
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

  if (!visible) { fileWarningBanner.hidden = true; expandHero(); return; }

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
  render();
}

function fromFileList(fileList: FileList | File[], getPath: (f: File) => string): FileEntry[] {
  return [...fileList].map(f => ({ file: f, path: getPath(f) }));
}

// — Strip & download —

async function stripAndDownload() {
  if (!entries.length) return;
  btnStrip.disabled = true;
  btnStrip.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Processing…';

  const blobs: { path: string; blob: Blob }[] = [];

  await Promise.all(entries.map(async entry => {
    const { file, path } = entry;
    const statusBadge = rowOf.get(file)?.querySelector<HTMLElement>('.status-badge');

    if (getSkipReason(file) !== null) {
      if (statusBadge) { statusBadge.textContent = 'Skipped'; statusBadge.className = 'badge badge-outline badge-sm status-badge'; }
      return;
    }

    try {
      const blob = await activeManager().strip(file);
      blobs.push({ path, blob });
      if (statusBadge) { statusBadge.textContent = 'Done'; statusBadge.className = 'badge badge-success badge-sm status-badge'; }
    } catch {
      if (statusBadge) { statusBadge.textContent = 'Error'; statusBadge.className = 'badge badge-error badge-sm status-badge'; }
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

  if (blobs.length > 0) {
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
    const collected: FileEntry[] = [];
    for (const fsEntry of fsEntries) {
      for await (const fe of scanDirectoryEntry(fsEntry)) collected.push(fe);
    }
    addEntries(collected);
  } else if (e.dataTransfer?.files) {
    addEntries(fromFileList(e.dataTransfer.files, f => f.name));
  }
});

btnClear.addEventListener('click', () => {
  for (const url of urlOf.values()) URL.revokeObjectURL(url);
  urlOf.clear();
  entries = [];
  levelOf.clear();
  metadataCache.clear();
  dirRowOf.clear();
  dirCounters.clear();
  render();
});

btnStrip.addEventListener('click', stripAndDownload);

// Paranoid mode
const labelSkipUnsupported = toggleSkipUnsupported.closest('label')!;
let savedSkipUnsupported = toggleSkipUnsupported.checked;

toggleParanoid.addEventListener('change', () => {
  if (settings.paranoid) {
    savedSkipUnsupported = toggleSkipUnsupported.checked;
    toggleSkipUnsupported.checked = false;
    toggleSkipUnsupported.disabled = true;
    labelSkipUnsupported.classList.add('opacity-40', 'pointer-events-none');
  } else {
    toggleSkipUnsupported.disabled = false;
    toggleSkipUnsupported.checked = savedSkipUnsupported;
    labelSkipUnsupported.classList.remove('opacity-40', 'pointer-events-none');
  }
  render();
});

toggleSkipClean.addEventListener('change', () => {
  for (const e of entries) applySkipStatus(e.file);
  syncFlatList();
  updateAllDirCounts();
});
toggleSkipUnsupported.addEventListener('change', () => {
  for (const e of entries) applySkipStatus(e.file);
  syncFlatList();
  updateAllDirCounts();
});

initSettingsPanel();
