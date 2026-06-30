// "What's new" reveal — installed/standalone PWA only. Web visitors get the
// version link to /changelog instead and are never interrupted.
//
// On load: if the running build is newer than the last version the user
// acknowledged, ping the version number and open a modal listing everything
// new (across skipped updates). Acknowledging sets the baseline.

import changelog from '../data/changelog.json';
import { entriesNewerThan, type ChangelogEntry } from '../lib/util/changelog.ts';

const SEEN_KEY = 'stripmeta:changelog_seen_v1';
const CURRENT = __APP_VERSION__;

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

function writeSeen(version: string): void {
  try { localStorage.setItem(SEEN_KEY, version); } catch { /* storage blocked — ignore */ }
}

function renderEntries(entries: ChangelogEntry[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    const section = document.createElement('section');
    section.className = 'space-y-2';

    const ver = document.createElement('p');
    ver.className = 'font-mono font-semibold text-base-content';
    ver.textContent = `v${entry.version}`;
    section.append(ver);

    if (entry.notes) {
      const p = document.createElement('p');
      p.className = 'text-sm text-base-content/70 whitespace-pre-line';
      p.textContent = entry.notes;
      section.append(p);
    } else if (entry.sections.length) {
      for (const sec of entry.sections) {
        const title = document.createElement('p');
        title.className = 'text-[0.65rem] font-semibold uppercase tracking-widest text-base-content/35';
        title.textContent = sec.title;
        const ul = document.createElement('ul');
        ul.className = 'list-disc pl-5 space-y-1 text-sm text-base-content/70';
        for (const item of sec.items) {
          const li = document.createElement('li');
          li.textContent = item.text;
          if (item.details.length) {
            const sub = document.createElement('ul');
            sub.className = 'list-[circle] pl-4 mt-1 space-y-0.5 text-xs text-base-content/50';
            for (const detail of item.details) {
              const subLi = document.createElement('li');
              subLi.textContent = detail;
              sub.append(subLi);
            }
            li.append(sub);
          }
          ul.append(li);
        }
        section.append(title, ul);
      }
    } else {
      const p = document.createElement('p');
      p.className = 'text-sm text-base-content/50 italic';
      p.textContent = 'Maintenance and internal improvements.';
      section.append(p);
    }
    frag.append(section);
  }
  return frag;
}

if (isStandalone) {
  const modal = document.getElementById('changelog-modal') as HTMLDialogElement | null;
  const body  = document.getElementById('changelog-modal-body') as HTMLElement | null;
  const badge = document.getElementById('changelog-badge') as HTMLElement | null;

  const seen = readSeen();
  const fresh = entriesNewerThan(changelog as ChangelogEntry[], seen);

  if (!seen) {
    // First standalone load — set the baseline silently, no backlog reveal.
    writeSeen(CURRENT);
  } else if (fresh.length && modal && body) {
    badge?.classList.remove('hidden');
    body.replaceChildren(renderEntries(fresh));
    modal.addEventListener('close', () => {
      writeSeen(CURRENT);
      badge?.classList.add('hidden');
    }, { once: true });
    try { modal.showModal(); } catch { /* another dialog open — badge still nudges */ }
  }
}

export {};
