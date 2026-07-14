import { settings, onSettingChange } from '../lib/state/settings.ts';
import { type StripStats, getStats, recordSession, clearStats } from '../lib/state/stats.ts';
import { formatBytes } from '../lib/util/format.ts';

const ABOUT_KEY  = 'stripmeta:about_shown_v1';

const modal          = document.getElementById('about-modal') as HTMLDialogElement | null;
const btnAbout       = document.getElementById('btn-about-footer') as HTMLButtonElement | null;
const aboutBadge     = document.getElementById('about-badge') as HTMLElement | null;
const statsSection   = document.getElementById('about-stats') as HTMLElement | null;
const statFiles      = document.getElementById('stat-files') as HTMLElement | null;
const statGps        = document.getElementById('stat-gps') as HTMLElement | null;
const statGpsWrap    = document.getElementById('stat-gps-wrap') as HTMLElement | null;
const statDates      = document.getElementById('stat-dates') as HTMLElement | null;
const statDatesWrap  = document.getElementById('stat-dates-wrap') as HTMLElement | null;
const statKb         = document.getElementById('stat-kb') as HTMLElement | null;
const statKbWrap     = document.getElementById('stat-kb-wrap') as HTMLElement | null;
const statsDate      = document.getElementById('stats-date') as HTMLElement | null;
const btnAboutNav    = document.getElementById('btn-about-nav') as HTMLButtonElement | null;
const btnClearStats  = document.getElementById('btn-clear-stats') as HTMLButtonElement | null;

let hasLiveSession = false;
let statsAnimated = false;

function animateCount(el: HTMLElement, target: number, delayMs: number): void {
  window.setTimeout(() => {
    const t0 = performance.now();
    const dur = 700;
    function tick(now: number) {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString();
    }
    requestAnimationFrame(tick);
  }, delayMs);
}

function animateKb(el: HTMLElement, target: number, delayMs: number): void {
  window.setTimeout(() => {
    const t0 = performance.now();
    const dur = 700;
    function tick(now: number) {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = formatBytes(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatBytes(target);
    }
    requestAnimationFrame(tick);
  }, delayMs);
}

function renderStats(stats: StripStats, animate: boolean): void {
  if (!statsSection) return;
  statsSection.classList.remove('hidden');
  animate = animate && !document.documentElement.classList.contains('no-glass');

  // Show/hide optional stat blocks based on whether they have data
  statGpsWrap?.classList.toggle('hidden', stats.gpsRemoved === 0);
  statDatesWrap?.classList.toggle('hidden', stats.datesRemoved === 0);
  statKbWrap?.classList.toggle('hidden', stats.bytesStripped === 0);

  if (animate) {
    if (statFiles) animateCount(statFiles, stats.filesProcessed, 0);
    if (statGps && stats.gpsRemoved > 0)   animateCount(statGps, stats.gpsRemoved, 80);
    if (statDates && stats.datesRemoved > 0) animateCount(statDates, stats.datesRemoved, 160);
    if (statKb && stats.bytesStripped > 0)   animateKb(statKb, stats.bytesStripped, 240);
  } else {
    if (statFiles) statFiles.textContent = stats.filesProcessed.toLocaleString();
    if (statGps)   statGps.textContent   = stats.gpsRemoved.toLocaleString();
    if (statDates) statDates.textContent = stats.datesRemoved.toLocaleString();
    if (statKb)    statKb.textContent    = stats.bytesStripped > 0 ? formatBytes(stats.bytesStripped) : '—';
  }

  if (statsDate) {
    if (stats.date) {
      const d = new Date(stats.date);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        statsDate.textContent = '';
      } else {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        statsDate.textContent = d.toDateString() === yesterday.toDateString()
          ? 'Yesterday'
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } else {
      statsDate.textContent = '';
    }
  }
}

function openModal(auto: boolean): void {
  if (!modal) return;
  if (auto) {
    if (localStorage.getItem(ABOUT_KEY)) return;
    if (!settings.autoAbout) return;
  }
  if (!modal.open) {
    try { modal.showModal(); } catch { return; }
  }
  if (auto) localStorage.setItem(ABOUT_KEY, '1');
  aboutBadge?.classList.add('hidden');

  const stats = getStats();
  if (stats) {
    const animate = hasLiveSession && !statsAnimated;
    if (animate) statsAnimated = true;
    renderStats(stats, animate);
  }
}

// Stats update on every strip — merge session totals with the cross-session base
window.addEventListener('stripmeta:processed', (e: Event) => {
  const session = (e as CustomEvent<StripStats>).detail;
  const merged = recordSession(session);
  hasLiveSession = true;
  statsAnimated = false;
  aboutBadge?.classList.remove('hidden');
  if (modal?.open) {
    statsAnimated = true;
    renderStats(merged, true);
  }
});

// Auto-show once after first error-free strip, deferred until download or copy
let pendingAutoShow = false;
let autoShowHandler: ((e: Event) => void) | null = null;

function registerAutoShowHandler(): void {
  if (autoShowHandler) return;
  autoShowHandler = (e: Event) => {
    if ((e as CustomEvent<{ hadErrors?: boolean }>).detail?.hadErrors) return;
    window.removeEventListener('stripmeta:processed', autoShowHandler!);
    autoShowHandler = null;
    pendingAutoShow = true;
  };
  window.addEventListener('stripmeta:processed', autoShowHandler);
}

function resetAutoShow(): void {
  localStorage.removeItem(ABOUT_KEY);
  pendingAutoShow = false;
  registerAutoShowHandler();
}

function tryAutoShow() {
  if (!pendingAutoShow) return;
  pendingAutoShow = false;
  openModal(true);
}

registerAutoShowHandler();
window.addEventListener('stripmeta:downloaded', tryAutoShow);
window.addEventListener('stripmeta:copied', tryAutoShow);

// Re-enable the toggle -> reset so the modal can auto-show again on next run
onSettingChange('autoAbout', () => { if (settings.autoAbout) resetAutoShow(); });

// "Clear storage" -> reset the already-shown flag and wipe stats
window.addEventListener('stripmeta:storageCleared', () => {
  resetAutoShow();
  clearStats();
  hasLiveSession = false;
  statsAnimated = false;
  statsSection?.classList.add('hidden');
});

btnAbout?.addEventListener('click', () => openModal(false));
btnAboutNav?.addEventListener('click', () => openModal(false));

btnClearStats?.addEventListener('click', () => {
  clearStats();
  hasLiveSession = false;
  statsAnimated = false;
  statsSection?.classList.add('hidden');
});

// Pre-fill from storage so stats are visible as soon as modal opens
const stored = getStats();
if (stored) {
  renderStats(stored, false);
}

export {};
