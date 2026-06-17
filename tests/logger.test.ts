import { describe, it, expect, vi } from 'vitest';
import type { LogEntry } from '../src/lib/state/logger';

// Each importFresh() resets module-level state (_entries, _listeners).
async function importFresh() {
  vi.resetModules();
  return import('../src/lib/state/logger');
}

const sample: LogEntry = {
  level: 'warning',
  fileName: 'photo.jpg',
  filePath: 'vacation/photo.jpg',
  message: 'Could not read metadata',
};

// ─── Log management ───────────────────────────────────────────────────────────

describe('logEntry / getLog', () => {
  it('adds an entry and makes it visible via getLog', async () => {
    const { logEntry, getLog } = await importFresh();
    logEntry(sample);
    expect(getLog()).toHaveLength(1);
    expect(getLog()[0]).toEqual(sample);
  });

  it('accumulates multiple entries in order', async () => {
    const { logEntry, getLog } = await importFresh();
    const err: LogEntry = { ...sample, level: 'error', fileName: 'bad.jpg' };
    logEntry(sample);
    logEntry(err);
    expect(getLog()).toHaveLength(2);
    expect(getLog()[0]?.level).toBe('warning');
    expect(getLog()[1]?.level).toBe('error');
  });

  it('getLog reflects mutations (live view, not a snapshot)', async () => {
    const { logEntry, getLog } = await importFresh();
    const log = getLog();
    logEntry(sample);
    expect(log).toHaveLength(1);
  });
});

describe('clearLog', () => {
  it('empties the log', async () => {
    const { logEntry, clearLog, getLog } = await importFresh();
    logEntry(sample);
    logEntry(sample);
    clearLog();
    expect(getLog()).toHaveLength(0);
  });
});

describe('onLogChange', () => {
  it('notifies listener when an entry is added', async () => {
    const { logEntry, onLogChange } = await importFresh();
    const listener = vi.fn();
    onLogChange(listener);
    logEntry(sample);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('notifies listener when the log is cleared', async () => {
    const { logEntry, clearLog, onLogChange } = await importFresh();
    const listener = vi.fn();
    onLogChange(listener);
    logEntry(sample);
    clearLog();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies all registered listeners', async () => {
    const { logEntry, onLogChange } = await importFresh();
    const a = vi.fn();
    const b = vi.fn();
    onLogChange(a);
    onLogChange(b);
    logEntry(sample);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});

// ─── humanizeError ────────────────────────────────────────────────────────────

describe('humanizeError', () => {
  it.each([
    ['not jpeg',               'File is not a valid JPEG despite its extension or MIME type'],
    ['this is Not JPEG data',  'File is not a valid JPEG despite its extension or MIME type'],
    ['Canvas encoding failed', 'Browser could not re-encode the image via canvas'],
    ['CANVAS ENCODING FAILED', 'Browser could not re-encode the image via canvas'],
    ['Could not decode image', 'Browser could not decode this image format'],
    ['invalid png structure',  'PNG file is corrupted or has an unrecognised structure'],
    ['Invalid PNG',            'PNG file is corrupted or has an unrecognised structure'],
    ['WebP: invalid format',   'WebP file is corrupted or invalid'],
    ['corrupt WebP data',      'WebP file is corrupted or invalid'],
    ['invalid webp header',    'WebP file is corrupted or invalid'],
    ['WebP is corrupt',        'WebP file is corrupted or invalid'],
  ])('maps Error("%s") to correct message', async (input, expected) => {
    const { humanizeError } = await importFresh();
    expect(humanizeError(new Error(input))).toBe(expected);
  });

  it('passes through unrecognised Error messages verbatim', async () => {
    const { humanizeError } = await importFresh();
    expect(humanizeError(new Error('something unexpected'))).toBe('something unexpected');
  });

  it('handles plain string throws (e.g. piexifjs)', async () => {
    const { humanizeError } = await importFresh();
    expect(humanizeError('not jpeg')).toBe('File is not a valid JPEG despite its extension or MIME type');
  });

  it('returns fallback for empty message', async () => {
    const { humanizeError } = await importFresh();
    expect(humanizeError(new Error(''))).toBe('An unexpected error occurred');
  });

  it('returns fallback for whitespace-only message', async () => {
    const { humanizeError } = await importFresh();
    expect(humanizeError(new Error('   '))).toBe('An unexpected error occurred');
  });

  it('stringifies non-Error, non-string values', async () => {
    const { humanizeError } = await importFresh();
    expect(humanizeError(42)).toBe('42');
    expect(humanizeError(null)).toBe('null');
  });
});
