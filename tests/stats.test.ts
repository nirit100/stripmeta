import { describe, it, expect, vi, beforeEach } from 'vitest';

// The stats store (lib/state/stats) is pure — only localStorage at init/writes,
// same shape as lib/state/settings. See settings.test.ts for the DOM-facing
// counterpart (scripts/about.ts renders what this store returns).

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/state/stats');
}

function setLS(entries: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(entries)) {
    localStorage.setItem(k, v);
  }
}

beforeEach(() => {
  localStorage.clear();
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns null when nothing has been recorded', async () => {
    const { getStats } = await importFresh();
    expect(getStats()).toBeNull();
  });

  it('loads previously saved stats when persistence is on', async () => {
    setLS({
      'stripmeta:stats_v1': JSON.stringify({
        filesProcessed: 3, gpsRemoved: 1, datesRemoved: 2, bytesStripped: 500, date: '2026-01-01T00:00:00.000Z',
      }),
    });
    const { getStats } = await importFresh();
    expect(getStats()).toEqual({
      filesProcessed: 3, gpsRemoved: 1, datesRemoved: 2, bytesStripped: 500, date: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ignores saved stats when persistence is off (noPersist)', async () => {
    setLS({
      'stripmeta-no-persist': '1',
      'stripmeta:stats_v1': JSON.stringify({ filesProcessed: 99, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 }),
    });
    const { getStats } = await importFresh();
    expect(getStats()).toBeNull();
  });

  it('returns null for corrupt stored JSON', async () => {
    setLS({ 'stripmeta:stats_v1': 'not-json' });
    const { getStats } = await importFresh();
    expect(getStats()).toBeNull();
  });
});

// ─── recordSession ────────────────────────────────────────────────────────────

describe('recordSession', () => {
  it('merges a session into zero totals when nothing was stored', async () => {
    const { recordSession } = await importFresh();
    const merged = recordSession({ filesProcessed: 2, gpsRemoved: 1, datesRemoved: 0, bytesStripped: 100 });
    expect(merged).toMatchObject({ filesProcessed: 2, gpsRemoved: 1, datesRemoved: 0, bytesStripped: 100 });
  });

  it('accumulates across multiple sessions in the same load', async () => {
    const { recordSession } = await importFresh();
    recordSession({ filesProcessed: 2, gpsRemoved: 1, datesRemoved: 0, bytesStripped: 100 });
    const merged = recordSession({ filesProcessed: 3, gpsRemoved: 0, datesRemoved: 1, bytesStripped: 50 });
    expect(merged).toMatchObject({ filesProcessed: 5, gpsRemoved: 1, datesRemoved: 1, bytesStripped: 150 });
  });

  it('adds on top of stats already saved in localStorage', async () => {
    setLS({
      'stripmeta:stats_v1': JSON.stringify({ filesProcessed: 10, gpsRemoved: 5, datesRemoved: 5, bytesStripped: 1000 }),
    });
    const { recordSession } = await importFresh();
    const merged = recordSession({ filesProcessed: 1, gpsRemoved: 1, datesRemoved: 1, bytesStripped: 1 });
    expect(merged).toMatchObject({ filesProcessed: 11, gpsRemoved: 6, datesRemoved: 6, bytesStripped: 1001 });
  });

  it('persists the merged totals to localStorage when persistence is on', async () => {
    const { recordSession } = await importFresh();
    recordSession({ filesProcessed: 4, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 });
    const raw = localStorage.getItem('stripmeta:stats_v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ filesProcessed: 4 });
  });

  it('does not persist to localStorage when persistence is off, but still returns the in-memory total', async () => {
    setLS({ 'stripmeta-no-persist': '1' });
    const { recordSession, getStats } = await importFresh();
    const merged = recordSession({ filesProcessed: 4, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 });
    expect(merged.filesProcessed).toBe(4);
    expect(localStorage.getItem('stripmeta:stats_v1')).toBeNull();
    expect(getStats()?.filesProcessed).toBe(4);
  });
});

// ─── clearStats ───────────────────────────────────────────────────────────────

describe('clearStats', () => {
  it('removes the saved stats and resets the in-memory totals to null', async () => {
    const { recordSession, clearStats, getStats } = await importFresh();
    recordSession({ filesProcessed: 4, gpsRemoved: 0, datesRemoved: 0, bytesStripped: 0 });
    expect(localStorage.getItem('stripmeta:stats_v1')).not.toBeNull();

    clearStats();

    expect(localStorage.getItem('stripmeta:stats_v1')).toBeNull();
    expect(getStats()).toBeNull();
  });
});
