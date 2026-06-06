import { readMetadata, defaultStripperManager, paranoidStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel, MetadataPreview, StripperManager } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';
import { getSkipReason as _getSkipReason } from '../lib/skip.ts';
import { openMetadataModal } from './modal.ts';
import { initSettingsPanel } from './settings-panel.ts';

const hero = document.getElementById('hero') as HTMLElement;
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileList = document.getElementById('file-list')!;
const fileWarningBanner = document.getElementById('file-warning-banner')!;
const actions = document.getElementById('actions')!;
const btnStrip = document.getElementById('btn-strip') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const toggleParanoid = document.getElementById('toggle-paranoid') as HTMLInputElement;
const toggleSkipClean = document.getElementById('toggle-skip-clean') as HTMLInputElement;
const toggleSkipUnsupported = document.getElementById('toggle-skip-unsupported') as HTMLInputElement;

const settings = {
  get paranoid() { return toggleParanoid.checked; },
  get skipClean() { return toggleSkipClean.checked; },
  get skipUnsupported() { return toggleSkipUnsupported.checked; },
};

function activeManager(): StripperManager {
  return settings.paranoid ? paranoidStripperManager : defaultStripperManager;
}

const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, none: 2 };

let files: File[] = [];
let sortedFiles: File[] = [];
let levelOf = new Map<File, WarningLevel>();
const metadataCache = new Map<File, MetadataPreview>();
let heroCollapsed = false;

function collapseHero() {
  if (heroCollapsed) return;
  heroCollapsed = true;
  for (const a of hero.getAnimations()) a.cancel();
  const h = hero.scrollHeight;
  hero.style.overflow = 'hidden';
  const anim = hero.animate(
    [{ height: h + 'px', opacity: 1, marginBottom: '0px' },
     { height: '0px', opacity: 0, marginBottom: '-2.5rem' }],
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
    [{ height: '0px', opacity: 0, marginBottom: '-2.5rem' },
     { height: h + 'px', opacity: 1, marginBottom: '0px' }],
    { duration: 350, easing: 'ease', fill: 'both' },
  );
  anim.onfinish = () => { anim.cancel(); hero.style.overflow = ''; };
}

const rowOf = new Map<File, HTMLElement>();
const urlOf = new Map<File, string>();

function detachFile(file: File) {
  const url = urlOf.get(file);
  if (url) URL.revokeObjectURL(url);
  urlOf.delete(file);
  metadataCache.delete(file);
  levelOf.delete(file);
  files = files.filter(f => f !== file);
  sortedFiles = sortedFiles.filter(f => f !== file);
  rowOf.delete(file);
}

function afterRemove() {
  if (files.length === 0) {
    fileList.classList.add('hidden');
    actions.classList.add('hidden');
    fileWarningBanner.hidden = true;
    expandHero();
  } else {
    renderBanner(levelOf);
  }
}

function removeFile(file: File) {
  const row = rowOf.get(file);
  detachFile(file);
  if (!row) { afterRemove(); return; }
  row.style.transition = 'opacity 150ms ease-out';
  row.style.opacity = '0';
  setTimeout(() => { row.remove(); afterRemove(); }, 160);
}

function addSwipeToRemove(slideTarget: HTMLElement, removeTarget: HTMLElement, file: File) {
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
      setTimeout(() => { detachFile(file); removeTarget.remove(); afterRemove(); }, 190);
    } else {
      slideTarget.style.transition = 'transform 200ms ease-out';
      slideTarget.style.transform = '';
      if (hint) {
        hint.style.transition = 'opacity 200ms ease-out';
        hint.style.opacity = '0';
      }
      setTimeout(() => { slideTarget.style.transition = ''; }, 210);
    }
  });
}

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
    statusBadge.textContent = 'Skipped — unsupported';
  } else if (reason === 'lossy') {
    statusBadge.textContent = 'Skipped — no lossless handler';
  } else if (reason === 'no-metadata') {
    statusBadge.textContent = 'Skipped — no metadata';
  } else {
    statusBadge.textContent = 'Ready';
  }
}

// Sorts files (skipped items last, then by warning level), updates status badges,
// and repositions DOM rows — all in one pass.
function syncList() {
  sortedFiles = [...files].sort((a, b) => {
    const aSkip = getSkipReason(a) !== null ? 1 : 0;
    const bSkip = getSkipReason(b) !== null ? 1 : 0;
    if (aSkip !== bSkip) return aSkip - bSkip;
    return WARNING_ORDER[levelOf.get(a) ?? 'none'] - WARNING_ORDER[levelOf.get(b) ?? 'none'];
  });
  for (const file of sortedFiles) {
    applySkipStatus(file);
    const row = rowOf.get(file);
    if (row) fileList.appendChild(row);
  }
}

// — File row —

function badge(cls: string, text: string, tip?: string, tipDir = 'tooltip-right'): HTMLElement {
  const el = document.createElement('span');
  el.className = `badge badge-xs [--size:1.25rem] cursor-default ${cls}${tip ? ` tooltip ${tipDir}` : ''}`;
  el.textContent = text;
  if (tip) el.dataset.tip = tip;
  return el;
}

function renderRow(file: File, level: WarningLevel): HTMLElement {
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

  // Left: name + subline
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

  // Container where metadata badges will be inserted asynchronously
  const badgesSlot = document.createElement('div');
  badgesSlot.className = 'contents';

  subline.append(sizeSpan, badgesSlot);

  left.append(nameEl, subline);

  // Right: status + remove button (top), handler row (bottom)
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
  removeBtn.addEventListener('click', () => removeFile(file));
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

  // Resolve handler name; append lossy badge inline when applicable
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

  // Apply initial skip state (unsupported is known now; no-metadata needs cache)
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
        const dateStr = String(preview.dateTime).slice(0, 10).replace(/:/g, '-');
        badgesSlot.appendChild(badge('badge-neutral font-mono', '📅 ' + dateStr));
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
      if (!preview.gps && !preview.make && !preview.model && !preview.serialNumber && !preview.dateTime && !preview.software && !preview.artist && !preview.userComment) {
        detailsBtn.textContent = 'no metadata';
      }
      syncList();
    }).catch(() => {});
  }

  addSwipeToRemove(body, row, file);
  return row;
}

// — Banner + render —

function renderBanner(levelOf: Map<File, WarningLevel>) {
  const levels = [...levelOf.values()];
  const lossy = levels.filter(l => l === 'lossy').length;
  const unsupported = levels.filter(l => l === 'unsupported').length;

  if (!lossy && !unsupported) {
    fileWarningBanner.hidden = true;
    fileWarningBanner.innerHTML = '';
    return;
  }

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
  fileWarningBanner.innerHTML = `
    <div class="alert alert-soft alert-warning flex flex-col items-start gap-1 text-sm">
      ${lines.map(l => `<p>${l}</p>`).join('')}
    </div>
  `;
}

async function render() {
  fileList.innerHTML = '';
  rowOf.clear();
  const visible = files.length > 0;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);

  if (!visible) { fileWarningBanner.hidden = true; expandHero(); return; }

  collapseHero();
  const levels = await Promise.all(files.map(f => activeManager().classify(f)));
  levelOf = new Map(files.map((f, i) => [f, levels[i]!]));

  for (const file of files) renderRow(file, levelOf.get(file)!);
  syncList();
  renderBanner(levelOf);
}

function addFiles(incoming: FileList | File[]) {
  const images = [...incoming].filter(f => f.type.startsWith('image/'));
  files = [...files, ...images].slice(0, 50);
  render();
}

// — Strip & download —

async function stripAndDownload() {
  if (!sortedFiles.length) return;
  btnStrip.disabled = true;
  btnStrip.textContent = 'Processing…';

  const blobs: { name: string; blob: Blob }[] = [];

  await Promise.all(sortedFiles.map(async file => {
    const statusBadge = rowOf.get(file)?.querySelector<HTMLElement>('.status-badge');

    if (getSkipReason(file) !== null) {
      if (statusBadge) {
        statusBadge.textContent = 'Skipped';
        statusBadge.className = 'badge badge-outline badge-sm status-badge';
      }
      return;
    }

    try {
      const blob = await activeManager().strip(file);
      blobs.push({ name: file.name, blob });
      if (statusBadge) {
        statusBadge.textContent = 'Done';
        statusBadge.className = 'badge badge-success badge-sm status-badge';
      }
    } catch {
      if (statusBadge) {
        statusBadge.textContent = 'Error';
        statusBadge.className = 'badge badge-error badge-sm status-badge';
      }
    }
  }));

  if (blobs.length === 1) {
    download(URL.createObjectURL(blobs[0].blob), blobs[0].name);
  } else if (blobs.length > 1) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const { name, blob } of blobs) zip.file(name, blob);
    download(URL.createObjectURL(await zip.generateAsync({ type: 'blob' })), 'stripped-photos.zip');
  }

  btnStrip.disabled = false;
  btnStrip.textContent = 'Strip metadata & download';

  // Notify others that the user successfully processed files at least once.
  if (blobs.length > 0) {
    try {
      window.dispatchEvent(new CustomEvent('stripmeta:processed'));
    } catch (e) {
      // ignore
    }
  }
}

function download(url: string, filename: string) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// — Event wiring —

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files) addFiles(fileInput.files); fileInput.value = ''; });

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('border-primary', 'bg-primary/5'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-primary', 'bg-primary/5'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('border-primary', 'bg-primary/5');
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
});

btnClear.addEventListener('click', () => {
  for (const url of urlOf.values()) URL.revokeObjectURL(url);
  urlOf.clear();
  files = [];
  sortedFiles = [];
  levelOf.clear();
  metadataCache.clear();
  render();
});
btnStrip.addEventListener('click', stripAndDownload);

// Paranoid mode changes classification → rebuild the full list.
// When paranoid is on, skip-unsupported is meaningless (all lossy files are processed),
// so we force it off and disable the control until paranoid is turned off.
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

// Skip toggles only change status badges and row opacity.
toggleSkipClean.addEventListener('change', syncList);
toggleSkipUnsupported.addEventListener('change', syncList);

initSettingsPanel();
