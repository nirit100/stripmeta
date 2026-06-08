import { describe, it, expect } from 'vitest';
import { computeToProcess, collectBlobs } from '../src/lib/stripPlan';
import type { FileEntry } from '../src/lib/stripPlan';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}
function entry(name: string): FileEntry {
  return { file: makeFile(name), path: name };
}
function blob(): Blob {
  return new Blob(['stripped'], { type: 'image/jpeg' });
}
const noSkip = () => null;
const skipAll = () => 'unsupported' as const;

// ─── computeToProcess ────────────────────────────────────────────────────────

describe('computeToProcess', () => {
  it('includes a ready file', () => {
    const e = entry('a.jpg');
    expect(computeToProcess([e], noSkip, new Set())).toContain(e);
  });

  it('excludes files already in stripDoneOf', () => {
    const e = entry('a.jpg');
    expect(computeToProcess([e], noSkip, new Set([e.file]))).toHaveLength(0);
  });

  it('excludes files with a skip reason', () => {
    const e = entry('a.gif');
    expect(computeToProcess([e], skipAll, new Set())).toHaveLength(0);
  });

  it('includes errored files for retry (not done, not skipped)', () => {
    const e = entry('err.jpg');
    // An errored file is absent from stripDoneOf and has no skip reason.
    expect(computeToProcess([e], noSkip, new Set())).toContain(e);
  });

  it('handles a mixed list correctly', () => {
    const done    = entry('done.jpg');
    const ready   = entry('ready.jpg');
    const skipped = entry('bad.gif');
    const errored = entry('err.jpg');

    const doneSet = new Set([done.file]);
    const skipFn  = (f: File) => f === skipped.file ? 'unsupported' : null;

    const result = computeToProcess([done, ready, skipped, errored], skipFn, doneSet);
    expect(result).not.toContain(done);
    expect(result).toContain(ready);
    expect(result).not.toContain(skipped);
    expect(result).toContain(errored);
  });

  it('returns an empty array when all files are done', () => {
    const entries = [entry('a.jpg'), entry('b.jpg')];
    const doneSet = new Set(entries.map(e => e.file));
    expect(computeToProcess(entries, noSkip, doneSet)).toHaveLength(0);
  });
});

// ─── collectBlobs ─────────────────────────────────────────────────────────────

describe('collectBlobs', () => {
  it('includes done files with their stripped blob', () => {
    const e = entry('a.jpg');
    const b = blob();
    const result = collectBlobs([e], noSkip, new Set([e.file]), new Map([[e.file, b]]), false);
    expect(result).toHaveLength(1);
    expect(result[0]!.blob).toBe(b);
    expect(result[0]!.path).toBe('a.jpg');
  });

  it('uses the stripped blob, not the original File', () => {
    const e = entry('a.jpg');
    const stripped = blob();
    const result = collectBlobs([e], noSkip, new Set([e.file]), new Map([[e.file, stripped]]), false);
    expect(result[0]!.blob).not.toBe(e.file);
    expect(result[0]!.blob).toBe(stripped);
  });

  it('includes skipped files as-is when includeSkipped is true', () => {
    const e = entry('bad.gif');
    const result = collectBlobs([e], skipAll, new Set(), new Map(), true);
    expect(result).toHaveLength(1);
    expect(result[0]!.blob).toBe(e.file);
  });

  it('excludes skipped files when includeSkipped is false', () => {
    const e = entry('bad.gif');
    expect(collectBlobs([e], skipAll, new Set(), new Map(), false)).toHaveLength(0);
  });

  it('excludes errored files (not done, no skip reason)', () => {
    const e = entry('err.jpg');
    expect(collectBlobs([e], noSkip, new Set(), new Map(), false)).toHaveLength(0);
    expect(collectBlobs([e], noSkip, new Set(), new Map(), true)).toHaveLength(0);
  });

  it('preserves the full relative path', () => {
    const e: FileEntry = { file: makeFile('photo.jpg'), path: 'vacation/beach/photo.jpg' };
    const b = blob();
    const result = collectBlobs([e], noSkip, new Set([e.file]), new Map([[e.file, b]]), false);
    expect(result[0]!.path).toBe('vacation/beach/photo.jpg');
  });

  it('handles a mixed list with includeSkipped false', () => {
    const done    = entry('done.jpg');
    const skipped = entry('bad.gif');
    const errored = entry('err.jpg');
    const pending = entry('new.jpg');
    const b = blob();

    const skipFn = (f: File) => f === skipped.file ? 'unsupported' : null;
    const result = collectBlobs(
      [done, skipped, errored, pending],
      skipFn,
      new Set([done.file]),
      new Map([[done.file, b]]),
      false,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.blob).toBe(b);
  });

  it('handles a mixed list with includeSkipped true', () => {
    const done    = entry('done.jpg');
    const skipped = entry('bad.gif');
    const errored = entry('err.jpg');
    const b = blob();

    const skipFn = (f: File) => f === skipped.file ? 'unsupported' : null;
    const result = collectBlobs(
      [done, skipped, errored],
      skipFn,
      new Set([done.file]),
      new Map([[done.file, b]]),
      true,
    );

    expect(result).toHaveLength(2);
    const paths = result.map(r => r.path);
    expect(paths).toContain('done.jpg');
    expect(paths).toContain('bad.gif');
    expect(paths).not.toContain('err.jpg');
  });

  it('returns empty when nothing is done and skipped is excluded', () => {
    const entries = [entry('a.jpg'), entry('b.jpg')];
    expect(collectBlobs(entries, noSkip, new Set(), new Map(), false)).toHaveLength(0);
  });
});
