import { readMetadata, stripMetadata, defaultStripperManager } from '../lib/stripMeta.ts';
import type { WarningLevel } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';

const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileList = document.getElementById('file-list')!;
const fileWarningBanner = document.getElementById('file-warning-banner')!;
const actions = document.getElementById('actions')!;
const btnStrip = document.getElementById('btn-strip') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, none: 2 };

let files: File[] = [];
let sortedFiles: File[] = [];

function renderRow(file: File, level: WarningLevel): HTMLElement {
  const row = document.createElement('div');
  row.className = 'card card-bordered bg-base-200 shadow-none';
  row.dataset.type = file.type;

  const body = document.createElement('div');
  body.className = 'card-body p-4 flex-row items-center gap-3';

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';
  info.innerHTML = `
    <div class="text-sm font-medium truncate">${file.name}</div>
    <div class="text-xs text-base-content/50 mt-0.5 meta-text">${formatBytes(file.size)} · Reading metadata…</div>
  `;

  body.appendChild(info);

  if (level === 'lossy') {
    const warn = document.createElement('div');
    warn.className = 'tooltip tooltip-left';
    warn.dataset.tip = 'Output will be re-encoded as JPEG (small quality loss)';
    warn.innerHTML = `<span class="badge badge-warning badge-sm gap-1">! Lossy</span>`;
    body.appendChild(warn);
  } else if (level === 'unsupported') {
    const warn = document.createElement('div');
    warn.className = 'tooltip tooltip-left';
    warn.dataset.tip = 'This format cannot be decoded in this browser — stripping will fail';
    warn.innerHTML = `<span class="badge badge-error badge-sm gap-1">✕ Unsupported</span>`;
    body.appendChild(warn);
  }

  const badge = document.createElement('div');
  badge.className = 'badge badge-ghost badge-sm whitespace-nowrap status-badge';
  badge.textContent = 'Ready';
  body.appendChild(badge);

  row.appendChild(body);

  if (level === 'none') {
    readMetadata(file).then(meta => {
      const parts: string[] = [];
      if (meta.gps) parts.push(`GPS: ${formatGps(meta.gps.latitude, meta.gps.longitude)}`);
      if (meta.make || meta.model) parts.push([meta.make, meta.model].filter(Boolean).join(' '));
      if (meta.serialNumber) parts.push(`S/N: ${meta.serialNumber}`);
      if (meta.dateTime) parts.push(String(meta.dateTime).slice(0, 10));
      const label = parts.length ? parts.join(' · ') : 'No metadata found';
      row.querySelector('.meta-text')!.textContent = `${formatBytes(file.size)} · ${label}`;
    }).catch(() => {
      row.querySelector('.meta-text')!.textContent = `${formatBytes(file.size)} · Could not read metadata`;
    });
  } else {
    row.querySelector('.meta-text')!.textContent = formatBytes(file.size);
  }

  return row;
}

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
  if (unsupported) {
    lines.push(`<span class="text-error font-medium">${unsupported} file${unsupported > 1 ? 's' : ''} cannot be processed</span> — format not supported in this browser.`);
  }
  if (lossy) {
    lines.push(`<span class="text-warning font-medium">${lossy} file${lossy > 1 ? 's' : ''} will be re-encoded as JPEG</span> — no lossless handler exists for their format.`);
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
  const visible = files.length > 0;
  fileList.classList.toggle('hidden', !visible);
  actions.classList.toggle('hidden', !visible);

  if (!visible) {
    fileWarningBanner.hidden = true;
    return;
  }

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

async function stripAndDownload() {
  if (!sortedFiles.length) return;
  btnStrip.disabled = true;
  btnStrip.textContent = 'Processing…';

  const rows = fileList.querySelectorAll<HTMLElement>('.card');
  const blobs: { name: string; blob: Blob }[] = [];

  await Promise.all(sortedFiles.map(async (file, i) => {
    const badge = rows[i]?.querySelector<HTMLElement>('.status-badge');
    try {
      const blob = await stripMetadata(file);
      blobs.push({ name: file.name, blob });
      if (badge) {
        badge.textContent = 'Done';
        badge.className = 'badge badge-success badge-sm whitespace-nowrap status-badge';
      }
    } catch {
      if (badge) {
        badge.textContent = 'Error';
        badge.className = 'badge badge-error badge-sm whitespace-nowrap status-badge';
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

// — event wiring —
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
