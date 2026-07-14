// Stats store: cross-session strip counters, persisted to localStorage under
// the same "Remember settings and stats" toggle as the settings store. No DOM
// — rendering, animation, and the About modal live in scripts/about.ts.
import { settings, noPersist } from './settings.ts';

export interface StripStats {
  filesProcessed: number;
  gpsRemoved: number;
  datesRemoved: number;
  bytesStripped: number;
  date?: string;
}

export const ZERO_STATS: StripStats = { filesProcessed: 0, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 };

const STATS_KEY = 'stripmeta:stats_v1';

function readStats(): StripStats | null {
  if (noPersist) return null;
  const raw = localStorage.getItem(STATS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StripStats; } catch { return null; }
}

function writeStats(stats: StripStats): void {
  if (!settings.persist) return;
  localStorage.setItem(STATS_KEY, JSON.stringify({ ...stats, date: new Date().toISOString() }));
}

let _totals: StripStats | null = readStats();

/** Current cross-session running totals, or null if nothing's been recorded (or persistence is off). */
export function getStats(): StripStats | null {
  return _totals;
}

/** Merge a just-completed session's deltas into the running totals, persist, and return the new total. */
export function recordSession(session: Omit<StripStats, 'date'>): StripStats {
  const base = _totals ?? ZERO_STATS;
  _totals = {
    filesProcessed: base.filesProcessed + session.filesProcessed,
    gpsRemoved:     base.gpsRemoved     + session.gpsRemoved,
    datesRemoved:   base.datesRemoved   + session.datesRemoved,
    bytesStripped:  base.bytesStripped  + session.bytesStripped,
  };
  writeStats(_totals);
  return _totals;
}

/** Remove the saved stats from localStorage and reset the in-memory running totals. */
export function clearStats(): void {
  localStorage.removeItem(STATS_KEY);
  _totals = null;
}
