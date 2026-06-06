import { readMetadata, readRichMetadata, stripMetadata, defaultStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel } from '../lib/stripMeta.ts';
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
const modalContent = modal.querySelector<HTMLElement>('.modal-content')!;

const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, none: 2 };

let files: File[] = [];
let sortedFiles: File[] = [];

// — Metadata modal —

function openMetadataModal(file: File) {
  modalTitle.textContent = file.name;
  modalContent.innerHTML = '<div class="flex justify-center py-10"><span class="loading loading-spinner loading-md"></span></div>';
  modal.showModal();

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
  row.className = 'card card-bordered bg-base-200 shadow-none';
  row.dataset.type = file.type;

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

  // Right: warning + status badges
  const right = document.createElement('div');
  right.className = 'flex flex-col items-end gap-1.5 shrink-0';

  if (level === 'lossy') {
    right.appendChild(badge('badge-warning badge-sm', '⚠️ Lossy', 'Output will be re-encoded as JPEG (small quality loss)', 'tooltip-left'));
  } else if (level === 'unsupported') {
    right.appendChild(badge('badge-error badge-sm', '✕ Unsupported', 'Cannot be decoded in this browser — stripping will fail', 'tooltip-left'));
  }

  const statusBadge = document.createElement('span');
  statusBadge.className = 'badge badge-ghost badge-sm status-badge';
  statusBadge.textContent = 'Ready';
  right.appendChild(statusBadge);

  body.append(left, right);
  row.appendChild(body);

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
      if (!preview.gps && !preview.make && !preview.model && !preview.serialNumber && !preview.dateTime && !preview.software) {
        detailsBtn.textContent = 'no metadata';
      }
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
  if (lossy) lines.push(`<span class="text-warning font-medium">${lossy} file${lossy > 1 ? 's' : ''} will be re-encoded as JPEG</span> — no lossless handler exists for their format.`);

  fileWarningBanner.hidden = false;
  fileWarningBanner.innerHTML = `
    <div class="alert alert-soft alert-warning flex flex-col items-start gap-1 text-sm">
      ${lines.map(l => `<p>${l}</p>`).join('')}
    </div>
  `;
}

async function render() {
  fileList.innerHTML = '';
  const visible = files.length > 0;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);

  if (!visible) { fileWarningBanner.hidden = true; return; }

  const levels = await Promise.all(files.map(f => defaultStripperManager.classify(f)));
  const levelOf = new Map(files.map((f, i) => [f, levels[i]!]));

  sortedFiles = [...files].sort((a, b) => WARNING_ORDER[levelOf.get(a)!] - WARNING_ORDER[levelOf.get(b)!]);
  sortedFiles.forEach(file => fileList.appendChild(renderRow(file, levelOf.get(file)!)));
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

  const rows = fileList.querySelectorAll<HTMLElement>('.card');
  const blobs: { name: string; blob: Blob }[] = [];

  await Promise.all(sortedFiles.map(async (file, i) => {
    const statusBadge = rows[i]?.querySelector<HTMLElement>('.status-badge');
    try {
      const blob = await stripMetadata(file);
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

btnClear.addEventListener('click', () => { files = []; sortedFiles = []; render(); });
btnStrip.addEventListener('click', stripAndDownload);
