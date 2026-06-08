import { readRichMetadata } from '../lib/stripMeta.ts';
import type { StripperManager } from '../lib/stripMeta.ts';
import { logEntry, humanizeError } from './logger.ts';

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

  readRichMetadata(file).then(({ sections, parseError, hasUnreadableData }) => {
    modalContent.innerHTML = '';

    if (parseError) {
      logEntry({ level: 'warning', fileName: file.name, filePath: file.name, message: 'Could not read metadata: ' + humanizeError(parseError) });
    }

    if (!sections.length) {
      const msg = document.createElement('p');
      msg.className = 'text-sm text-base-content/50 py-10 text-center';
      msg.textContent = parseError
        ? 'Could not read metadata from this file.'
        : hasUnreadableData
          ? 'Metadata was found but could not be displayed (binary or proprietary format).'
          : 'No metadata found in this file.';
      modalContent.appendChild(msg);
      return;
    }

    // Collect value containers so we can detect overflow after layout in one rAF.
    const overflowCandidates: HTMLDivElement[] = [];

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
        const tdKey = document.createElement('td');
        tdKey.className = `w-2/5 align-top font-medium py-1 pr-3 ${pii ? 'text-warning' : 'text-base-content/50'}`;
        tdKey.textContent = key;

        const tdVal = document.createElement('td');
        tdVal.className = 'break-all py-1 align-top text-base-content/80';

        // Wrap value in a div so we can clamp long text per-cell.
        const valWrap = document.createElement('div');
        valWrap.className = 'relative';
        const valText = document.createElement('div');
        valText.className = 'overflow-hidden';
        valText.style.maxHeight = '4.5em'; // tentative 3-line cap; removed if not overflowing
        valText.textContent = value;
        valWrap.appendChild(valText);
        tdVal.appendChild(valWrap);

        tr.append(tdKey, tdVal);
        tbody.appendChild(tr);
        overflowCandidates.push(valText);
      }
      table.appendChild(tbody);
      modalContent.append(heading, table);
    }

    // After layout: wire up expand/collapse only for cells that actually overflow.
    requestAnimationFrame(() => {
      for (const valText of overflowCandidates) {
        if (valText.scrollHeight <= valText.clientHeight + 2) {
          valText.style.maxHeight = '';
          continue;
        }

        const valWrap = valText.parentElement!;
        // btn lives outside valWrap so the absolute-positioned fade (bottom:0 of valWrap)
        // doesn't sit on top of it.
        const tdVal   = valWrap.parentElement!;

        const fade = document.createElement('div');
        fade.className = 'absolute inset-x-0 bottom-0 h-8 pointer-events-none';
        fade.style.background = 'linear-gradient(to bottom, transparent, var(--color-base-100))';
        valWrap.appendChild(fade);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-[0.65rem] text-base-content/40 hover:text-primary transition-colors mt-0.5 leading-none block';
        btn.textContent = 'show more…';
        tdVal.appendChild(btn);

        let open = false;
        btn.addEventListener('click', () => {
          open = !open;
          valText.style.maxHeight = open ? '' : '4.5em';
          fade.hidden = open;
          btn.textContent = open ? 'show less' : 'show more…';
        });
      }
    });

    if (parseError) {
      const notice = document.createElement('p');
      notice.className = 'mt-4 text-[0.65rem] text-warning/70 leading-relaxed';
      notice.textContent = 'Some metadata could not be parsed and may not be shown above.';
      modalContent.appendChild(notice);
    } else if (hasUnreadableData) {
      const notice = document.createElement('p');
      notice.className = 'mt-4 text-[0.65rem] text-base-content/35 leading-relaxed';
      notice.textContent = 'Some metadata fields could not be displayed (binary or proprietary data).';
      modalContent.appendChild(notice);
    }

    const disclaimer = document.createElement('p');
    disclaimer.className = 'mt-5 text-[0.65rem] text-base-content/35 leading-relaxed';
    disclaimer.textContent = 'Fields highlighted in amber may contain personally identifiable data. However, the combination of multiple fields — even seemingly innocent ones like timestamps or device settings — can be just as identifying as explicit location data.';
    modalContent.appendChild(disclaimer);
  }).catch(() => {
    modalContent.innerHTML = '<p class="text-sm text-error py-10 text-center">Could not read metadata.</p>';
  });
}
