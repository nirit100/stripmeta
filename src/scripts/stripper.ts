import { readMetadata, stripMetadata } from '../lib/stripMeta.ts';
import { formatBytes, formatGps } from '../lib/format.ts';

const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileList = document.getElementById('file-list')!;
const actions = document.getElementById('actions')!;
const btnStrip = document.getElementById('btn-strip') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

let files: File[] = [];

function renderRow(file: File, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'card card-bordered bg-base-200 shadow-none';
  row.dataset.index = String(index);

  const body = document.createElement('div');
  body.className = 'card-body p-4 flex-row items-center gap-4';

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';
  info.innerHTML = `
    <div class="text-sm font-medium truncate">${file.name}</div>
    <div class="text-xs text-base-content/50 mt-0.5 meta-text">${formatBytes(file.size)} · Reading metadata…</div>
  `;

  const badge = document.createElement('div');
  badge.className = 'badge badge-ghost badge-sm whitespace-nowrap status-badge';
  badge.textContent = 'Ready';

  body.appendChild(info);
  body.appendChild(badge);
  row.appendChild(body);

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

  return row;
}

function render() {
  fileList.innerHTML = '';
  fileList.classList.toggle('hidden', files.length === 0);
  actions.classList.toggle('hidden', files.length === 0);
  files.forEach((file, i) => fileList.appendChild(renderRow(file, i)));
}

function addFiles(incoming: FileList | File[]) {
  const images = [...incoming].filter(f => f.type.startsWith('image/'));
  files = [...files, ...images].slice(0, 50);
  render();
}

async function stripAndDownload() {
  if (!files.length) return;
  btnStrip.disabled = true;
  btnStrip.textContent = 'Processing…';

  const rows = fileList.querySelectorAll<HTMLElement>('[data-index]');
  const blobs: { name: string; blob: Blob }[] = [];

  await Promise.all(files.map(async (file, i) => {
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

btnClear.addEventListener('click', () => { files = []; render(); });
btnStrip.addEventListener('click', stripAndDownload);
