import { iconSvg } from '../lib/icons.ts';
import { siGooglemaps, siOpenstreetmap, siApple } from 'simple-icons';

const brandIcon = (path: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

/**
 * Shows a dismissable popover anchored to `anchor` with map-service links for
 * the given coordinates. Only one popover exists at a time; opening replaces
 * any previous one, and an outside click closes it.
 */
export function showGpsPopover(anchor: HTMLElement, lat: number, lon: number, coordStr: string): void {
  document.getElementById('gps-map-pop')?.remove();

  const pop = document.createElement('div');
  pop.id = 'gps-map-pop';
  pop.className = 'fixed z-50 bg-base-200 border border-base-300 rounded-lg shadow-lg overflow-hidden min-w-[13rem]';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-3 py-2 border-b border-base-300/60';
  const pinIcon = document.createElement('span');
  pinIcon.className = 'shrink-0 text-error/60';
  pinIcon.innerHTML = iconSvg('map-pin', 'w-4 h-4 block', '1.5');
  const coordText = document.createElement('span');
  coordText.className = 'text-xs font-mono text-base-content/55 select-all';
  coordText.textContent = coordStr;
  header.append(pinIcon, coordText);
  pop.appendChild(header);

  const services: [string, string, string][] = [
    ['OpenStreetMap', `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=14`, siOpenstreetmap.path],
    ['Google Maps',   `https://maps.google.com/?q=${lat},${lon}`,                       siGooglemaps.path],
    ['Apple Maps',    `https://maps.apple.com/?q=${lat},${lon}`,                        siApple.path],
  ];
  for (const [name, url, path] of services) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'flex items-center gap-2.5 px-3 py-2.5 text-xs text-base-content/70 hover:bg-base-300 hover:text-base-content transition-colors';
    const ico = document.createElement('span');
    ico.className = 'shrink-0 flex items-center text-base-content/40';
    ico.innerHTML = brandIcon(path);
    const label = document.createElement('span');
    label.textContent = name;
    a.append(ico, label);
    pop.appendChild(a);
  }
  document.body.appendChild(pop);

  // Position below the badge; nudge left if it clips the right edge.
  const rect = anchor.getBoundingClientRect();
  pop.style.top  = `${rect.bottom + 4}px`;
  const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8);
  pop.style.left = `${Math.max(8, left)}px`;

  const dismiss = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener('click', dismiss, true); }
  };
  // Defer so this click doesn't immediately dismiss the popover.
  setTimeout(() => document.addEventListener('click', dismiss, true), 0);
}
