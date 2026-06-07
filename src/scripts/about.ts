import { settings } from './settings.ts';

const ABOUT_KEY  = 'stripmeta:about_shown_v1';
const STATS_KEY  = 'stripmeta:stats_v1';

const modal       = document.getElementById('about-modal') as HTMLDialogElement | null;
const btnAbout    = document.getElementById('btn-about-footer') as HTMLButtonElement | null;
const aboutBadge  = document.getElementById('about-badge') as HTMLElement | null;
const statsSection = document.getElementById('about-stats') as HTMLElement | null;
const statFiles   = document.getElementById('stat-files') as HTMLElement | null;
const statGps     = document.getElementById('stat-gps') as HTMLElement | null;
const statGpsWrap = document.getElementById('stat-gps-wrap') as HTMLElement | null;
const statDates   = document.getElementById('stat-dates') as HTMLElement | null;
const statDatesWrap = document.getElementById('stat-dates-wrap') as HTMLElement | null;
const statKb      = document.getElementById('stat-kb') as HTMLElement | null;
const statKbWrap  = document.getElementById('stat-kb-wrap') as HTMLElement | null;
const statsDate      = document.getElementById('stats-date') as HTMLElement | null;
const btnAboutNav    = document.getElementById('btn-about-nav') as HTMLButtonElement | null;
const btnClearStats  = document.getElementById('btn-clear-stats') as HTMLButtonElement | null;

interface StripStats {
  filesProcessed: number;
  gpsRemoved: number;
  datesRemoved: number;
  bytesStripped: number;
  date?: string;
}

let liveStats: StripStats | null = null;
let statsAnimated = false;

function shouldPersist(): boolean {
  return localStorage.getItem('stripmeta-no-persist') !== '1';
}

function saveStats(stats: StripStats): void {
  if (!shouldPersist()) return;
  localStorage.setItem(STATS_KEY, JSON.stringify({ ...stats, date: new Date().toISOString() }));
}

function loadStoredStats(): StripStats | null {
  const raw = localStorage.getItem(STATS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StripStats; } catch { return null; }
}

function fmtBytes(n: number): string {
  if (n < 1024)        return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

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
      el.textContent = fmtBytes(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = fmtBytes(target);
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
    if (statKb)    statKb.textContent    = stats.bytesStripped > 0 ? fmtBytes(stats.bytesStripped) : '—';
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

  const stats = liveStats ?? loadStoredStats();
  if (stats) {
    const animate = !!liveStats && !statsAnimated;
    if (animate) statsAnimated = true;
    renderStats(stats, animate);
  }
}

// Stats update on every strip
window.addEventListener('stripmeta:processed', (e: Event) => {
  const stats = (e as CustomEvent<StripStats>).detail;
  liveStats = stats;
  statsAnimated = false;
  saveStats(stats);
  aboutBadge?.classList.remove('hidden');
  if (modal?.open) {
    statsAnimated = true;
    renderStats(stats, true);
  }
});

// Auto-show once after first strip
window.addEventListener('stripmeta:processed', () => openModal(true), { once: true });

btnAbout?.addEventListener('click', () => openModal(false));
btnAboutNav?.addEventListener('click', () => openModal(false));

btnClearStats?.addEventListener('click', () => {
  localStorage.removeItem(STATS_KEY);
  liveStats = null;
  statsAnimated = false;
  statsSection?.classList.add('hidden');
});

// Pre-fill from storage so stats are visible as soon as modal opens
const stored = loadStoredStats();
if (stored) renderStats(stored, false);

export {};
