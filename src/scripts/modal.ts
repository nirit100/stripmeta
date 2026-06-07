import { readRichMetadata } from '../lib/stripMeta.ts';
import type { StripperManager } from '../lib/stripMeta.ts';

// Matches EXIF/PNG text keys that commonly carry personally identifiable data.
// Strips punctuation/spaces before testing so "Creation Time", "By-Line", etc. all match.
const PII_RE = /gps|latit|longit|altit|serial|make|model|artist|author|creator|owner|copyright|byline|comment|caption|description|subject|keyword|title|software|uniqueid|datetime|createdate|createtime|creationtime|modifydate|timestamp/;

function isPiiKey(key: string): boolean {
  return PII_RE.test(key.toLowerCase().replace(/[^a-z]/g, ''));
}

const modal = document.getElementById('metadata-modal') as HTMLDialogElement;
const modalTitle = modal.querySelector<HTMLElement>('.modal-title')!;
const modalHandler = modal.querySelector<HTMLElement>('.modal-handler')!;
const modalContent = modal.querySelector<HTMLElement>('.modal-content')!;

export function openMetadataModal(file: File, manager: StripperManager): void {
  modalTitle.textContent = file.name;
  modalHandler.textContent = '';
  modalHandler.classList.add('hidden');
  modalContent.innerHTML = '<div class="flex justify-center py-10"><span class="loading loading-spinner loading-md"></span></div>';
  modal.showModal();

  manager.resolve(file).then(h => {
    modalHandler.innerHTML = `<span class="font-semibold text-base-content/60">${h.name}</span><span class="mx-1.5 text-base-content/30">—</span>${h.description}`;
    modalHandler.classList.remove('hidden');
  }).catch(() => {});

  readRichMetadata(file).then(sections => {
    modalContent.innerHTML = '';
    if (!sections.length) {
      const msg = document.createElement('p');
      msg.className = 'text-sm text-base-content/50 py-10 text-center';
      msg.textContent = 'No metadata found in this file.';
      modalContent.appendChild(msg);
      return;
    }
    for (const [i, section] of sections.entries()) {
      const heading = document.createElement('p');
      heading.className = 'text-xs font-semibold uppercase tracking-widest text-base-content/45 mb-1.5' + (i > 0 ? ' mt-5' : '');
      heading.textContent = section.name;

      const table = document.createElement('table');
      table.className = 'table table-xs w-full';
      const tbody = document.createElement('tbody');
      for (const { key, value } of section.entries) {
        const pii = isPiiKey(key);
        const tr = document.createElement('tr');
        if (pii) tr.className = 'bg-warning/10';
        const tdKey = document.createElement('td');
        tdKey.className = `w-2/5 align-top font-medium py-1 pr-3 ${pii ? 'text-warning/70' : 'text-base-content/50'}`;
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

    const disclaimer = document.createElement('p');
    disclaimer.className = 'mt-5 text-[0.65rem] text-base-content/35 leading-relaxed';
    disclaimer.textContent = 'Fields highlighted in amber may contain personally identifiable data. However, the combination of multiple fields — even seemingly innocent ones like timestamps or device settings — can be just as identifying as explicit location data.';
    modalContent.appendChild(disclaimer);
  }).catch(() => {
    modalContent.innerHTML = '<p class="text-sm text-error py-10 text-center">Could not read metadata.</p>';
  });
}
