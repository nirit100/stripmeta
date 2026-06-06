import { readMetadata, readRichMetadata, defaultStripperManager, paranoidStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel, MetadataPreview, StripperManager } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';

const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileList = document.getElementById('file-list')!;
const fileWarningBanner = document.getElementById('file-warning-banner')!;
const actions = document.getElementById('actions')!;
const btnStrip = document.getElementById('btn-strip') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const modal = document.getElementById('metadata-modal') as HTMLDialogElement;
const modalTitle = modal.querySelector<HTMLElement>('.modal-title')!;
const modalHandler = modal.querySelector<HTMLElement>('.modal-handler')!;
const modalContent = modal.querySelector<HTMLElement>('.modal-content')!;

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
const rowOf = new Map<File, HTMLElement>();

function getSkipReason(file: File): 'unsupported' | 'lossy' | 'no-metadata' | null {
  if (settings.skipUnsupported) {
    const level = levelOf.get(file);
    if (level === 'unsupported') return 'unsupported';
    // 'lossy' means no lossless handler — treat as unsupported unless paranoid mode is on
    // (paranoid explicitly re-encodes via canvas, so the user accepts lossy output)
    if (!settings.paranoid && level === 'lossy') return 'lossy';
  }
  if (settings.skipClean) {
    const meta = metadataCache.get(file);
    if (meta && !meta.gps && !meta.make && !meta.model && !meta.serialNumber && !meta.dateTime && !meta.software) {
      return 'no-metadata';
    }
  }
  return null;
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

// — Metadata modal —

function openMetadataModal(file: File) {
  modalTitle.textContent = file.name;
  modalHandler.textContent = '';
  modalHandler.classList.add('hidden');
  modalContent.innerHTML = '<div class="flex justify-center py-10"><span class="loading loading-spinner loading-md"></span></div>';
  modal.showModal();

  activeManager().resolve(file).then(h => {
    modalHandler.innerHTML = `<span class="font-semibold text-base-content/50">${h.name}</span><span class="mx-1.5 text-base-content/20">—</span>${h.description}`;
    modalHandler.classList.remove('hidden');
  }).catch(() => {});

  readRichMetadata(file).then(sections => {
    modalContent.innerHTML = '';
    if (!sections.length) {
      const msg = document.createElement('p');
      msg.className = 'text-sm text-base-content/40 py-10 text-center';
      msg.textContent = 'No metadata found in this file.';
      modalContent.appendChild(msg);
      return;
    }
    for (const [i, section] of sections.entries()) {
      const heading = document.createElement('p');
      heading.className = 'text-xs font-semibold uppercase tracking-widest text-base-content/35 mb-1.5' + (i > 0 ? ' mt-5' : '');
      heading.textContent = section.name;

      const table = document.createElement('table');
      table.className = 'table table-xs w-full';
      const tbody = document.createElement('tbody');
      for (const { key, value } of section.entries) {
        const tr = document.createElement('tr');
        const tdKey = document.createElement('td');
        tdKey.className = 'text-base-content/50 w-2/5 align-top font-medium py-1 pr-3';
        tdKey.textContent = key;
        const tdVal = document.createElement('td');
        tdVal.className = 'break-all py-1 text-base-content/80';
        tdVal.textContent = value;
        tr.append(tdKey, tdVal);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      modalContent.append(heading, table);
    }
  }).catch(() => {
    modalContent.innerHTML = '<p class="text-sm text-error py-10 text-center">Could not read metadata.</p>';
  });
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
  row.className = 'card card-bordered bg-base-200 shadow-none transition-opacity';
  row.dataset.type = file.type;
  rowOf.set(file, row);

  const body = document.createElement('div');
  body.className = 'card-body p-4 flex-row items-start gap-3';

  // Left: name + subline
  const left = document.createElement('div');
  left.className = 'flex-1 min-w-0 space-y-1.5';

  const nameEl = document.createElement('div');
  nameEl.className = 'text-sm font-medium truncate leading-snug';
  nameEl.textContent = file.name;

  const subline = document.createElement('div');
  subline.className = 'flex flex-wrap items-center gap-1.5';

  const sizeSpan = document.createElement('span');
  sizeSpan.className = 'text-xs text-base-content/35 shrink-0';
  sizeSpan.textContent = formatBytes(file.size);

  // Container where metadata badges will be inserted asynchronously
  const badgesSlot = document.createElement('div');
  badgesSlot.className = 'contents';

  subline.append(sizeSpan, badgesSlot);

  left.append(nameEl, subline);

  // Right: status + handler row (with inline lossy badge)
  const right = document.createElement('div');
  right.className = 'flex flex-col items-end gap-1 shrink-0';

  if (level === 'unsupported') {
    right.appendChild(badge('badge-error badge-sm', '✕ Unsupported', 'Cannot be decoded in this browser — stripping will fail', 'tooltip-left'));
  }

  const statusBadge = document.createElement('span');
  statusBadge.className = 'badge badge-ghost badge-sm status-badge';
  statusBadge.textContent = 'Ready';
  right.appendChild(statusBadge);

  const handlerRow = document.createElement('div');
  handlerRow.className = 'flex items-center gap-1.5';
  const handlerInfo = document.createElement('span');
  handlerInfo.className = 'text-xs text-base-content/25';
  handlerRow.appendChild(handlerInfo);
  right.appendChild(handlerRow);

  body.append(left, right);
  row.appendChild(body);

  // Resolve handler name; append lossy badge inline when applicable
  activeManager().resolve(file).then(h => {
    handlerInfo.textContent = h.name;
    if (level === 'lossy') {
      handlerRow.appendChild(badge('badge-warning badge-xs', '⚠️ Lossy', 'Output will be re-encoded as JPEG (small quality loss)', 'tooltip-left'));
    }
  }).catch(() => {});

  // Apply initial skip state (unsupported is known now; no-metadata needs cache)
  applySkipStatus(file);

  if (level !== 'unsupported') {
    const sep = document.createElement('span');
    sep.className = 'text-base-content/20 text-xs select-none shrink-0';
    sep.textContent = '·';
    const detailsBtn = document.createElement('button');
    detailsBtn.type = 'button';
    detailsBtn.className = 'text-xs text-base-content/30 hover:text-primary transition-colors shrink-0';
    detailsBtn.textContent = 'details…';
    detailsBtn.addEventListener('click', () => openMetadataModal(file));
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
        badgesSlot.appendChild(badge('badge-warning', '# S/N', preview.serialNumber));
      }
      if (preview.dateTime) {
        const dateStr = String(preview.dateTime).slice(0, 10).replace(/:/g, '-');
        badgesSlot.appendChild(badge('badge-ghost font-mono', dateStr));
      }
      if (preview.software) {
        badgesSlot.appendChild(badge('badge-ghost max-w-[8rem] truncate', preview.software, preview.software));
      }
      metadataCache.set(file, preview);
      if (!preview.gps && !preview.make && !preview.model && !preview.serialNumber && !preview.dateTime && !preview.software) {
        detailsBtn.textContent = 'no metadata';
      }
      syncList();
    }).catch(() => {});
  }

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

  if (!visible) { fileWarningBanner.hidden = true; return; }

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
        statusBadge.className = 'badge badge-ghost badge-sm status-badge';
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

btnClear.addEventListener('click', () => { files = []; sortedFiles = []; levelOf.clear(); metadataCache.clear(); render(); });
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

// Animate settings panel open and close.
const settingsDetails = document.getElementById('settings-details') as HTMLDetailsElement;
const settingsBody = settingsDetails.querySelector<HTMLElement>('.settings-body')!;

settingsDetails.querySelector('summary')!.addEventListener('click', e => {
  e.preventDefault();
  if (settingsDetails.open) {
    settingsBody.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
      { duration: 150, easing: 'ease' },
    ).onfinish = () => settingsDetails.removeAttribute('open');
  } else {
    settingsDetails.setAttribute('open', '');
    settingsBody.animate(
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 200, easing: 'ease' },
    );
  }
});
