// "What's new" reveal — installed/standalone PWA only. Web visitors get the
// version link to /changelog instead and are never interrupted.
//
// On load: if the running build is newer than the last version the user
// acknowledged (i.e. an update was applied since they last looked), ping the
// footer version number with a dot — once. The baseline is bumped on the same
// load, so the dot shows only on this first post-update load and is gone on the
// next reload. A one-time nudge, never a nag; the popup is never auto-opened.
//
// The popup opens only from the "What's new" link in the update toast, which
// fetches the newest deployed /changelog.json to preview the incoming version's
// notes before the update is applied.

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

export function renderEntries(entries: ChangelogEntry[]): DocumentFragment {
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

/** Marks the baseline version the entries above were diffed against. */
export function renderCurrentVersionPin(version: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2 pt-3 mt-1 border-t border-base-300/60';

  const ver = document.createElement('p');
  ver.className = 'font-mono font-semibold text-base-content';
  ver.textContent = `v${version}`;
  wrap.append(ver);

  const tag = document.createElement('span');
  tag.className = 'text-[0.65rem] font-semibold uppercase tracking-widest text-base-content/35';
  tag.textContent = "you're here";
  wrap.append(tag);

  return wrap;
}

/**
 * Fetch the newest deployed changelog and open the "what's new" modal previewing
 * everything the running build doesn't have yet. Called from the update toast's
 * "What's new" link — the new deploy is already live server-side, so this shows
 * the incoming version's notes without applying the update. Does not acknowledge.
 */
async function openWhatsNew(): Promise<void> {
  const modal = document.getElementById('changelog-modal') as HTMLDialogElement | null;
  const body  = document.getElementById('changelog-modal-body') as HTMLElement | null;
  if (!modal || !body) return;

  let data = changelog as ChangelogEntry[];
  try {
    const res = await fetch('/changelog.json', { cache: 'no-store' });
    if (res.ok) data = (await res.json()) as ChangelogEntry[];
  } catch { /* offline — fall back to the bundled changelog */ }

  const fresh = entriesNewerThan(data, CURRENT);
  body.replaceChildren(renderEntries(fresh), renderCurrentVersionPin(CURRENT));
  try { modal.showModal(); } catch { /* another dialog already open */ }
}

if (isStandalone) {
  const badge = document.getElementById('changelog-badge');
  const seen  = readSeen();

  if (!seen) {
    // First standalone load — set the baseline silently, no backlog reveal.
    writeSeen(CURRENT);
  } else if (entriesNewerThan(changelog as ChangelogEntry[], seen).length) {
    // An update was applied since the user last looked — nudge the footer
    // version with a dot. No popup; the user opens it from the update toast.
    // Acknowledge right away so the dot shows only on this first post-update
    // load and is gone on the next reload — a one-time nudge, not a nag.
    badge?.classList.remove('hidden');
    writeSeen(CURRENT);
  }

  document.getElementById('pwa-update-whatsnew')?.addEventListener('click', openWhatsNew);
}

export {};
