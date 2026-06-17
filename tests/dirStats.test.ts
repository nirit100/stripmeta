import { describe, it, expect } from 'vitest';
import { computeDirStats, formatDirStat, dirStatusDot, isDirDimmed, type DirStatsDeps } from '../src/lib/dirStats';
import type { FileEntry } from '../src/lib/stripPlan';
import type { SkipReason } from '../src/lib/skip';

let id = 0;
function entry(): FileEntry {
  return { file: new File(['x'], `f${id++}.jpg`, { type: 'image/jpeg' }), path: 'd/f.jpg' };
}

// Build deps from explicit per-entry reason/done/errored assignments.
function deps(
  reasons: Map<FileEntry, SkipReason | null>,
  done: FileEntry[] = [],
  errored: FileEntry[] = [],
): DirStatsDeps {
  return {
    skipReason: f => [...reasons].find(([e]) => e.file === f)?.[1] ?? null,
    done: new Set(done.map(e => e.file)),
    errored: new Set(errored.map(e => e.file)),
  };
}

describe('computeDirStats', () => {
  it('tallies ready/incompatible/clean/done/errored', () => {
    const ready = entry(), lossy = entry(), unsup = entry(), noMeta = entry(), errd = entry();
    const reasons = new Map<FileEntry, SkipReason | null>([
      [ready, null], [lossy, 'lossy'], [unsup, 'unsupported'], [noMeta, 'no-metadata'], [errd, null],
    ]);
    const under = [ready, lossy, unsup, noMeta, errd];
    const s = computeDirStats(under, deps(reasons, [ready], [errd]));
    expect(s).toEqual({ n: 5, incompatible: 2, clean: 1, stripErrors: 1, done: 1, ready: 2 });
  });

  it('counts experimental as incompatible', () => {
    const e = entry();
    const s = computeDirStats([e], deps(new Map([[e, 'experimental']])));
    expect(s.incompatible).toBe(1);
    expect(s.ready).toBe(0);
  });

  it('is all-ready when nothing is skipped', () => {
    const es = [entry(), entry(), entry()];
    const s = computeDirStats(es, deps(new Map()));
    expect(s).toMatchObject({ n: 3, ready: 3, incompatible: 0, clean: 0 });
  });
});

describe('formatDirStat', () => {
  const base = { n: 0, incompatible: 0, clean: 0, stripErrors: 0, done: 0, ready: 0 };

  it('shows only the count before classification (hasLevels=false)', () => {
    expect(formatDirStat({ ...base, n: 3, ready: 3 }, false)).toBe('3 files');
    expect(formatDirStat({ ...base, n: 1, ready: 1 }, false)).toBe('1 file');
  });

  it('appends a breakdown once classified', () => {
    expect(formatDirStat({ ...base, n: 5, ready: 3, incompatible: 2 }, true))
      .toBe('5 files · 3 ready, 2 incompatible');
  });

  it('pluralises errors and lists no-metadata', () => {
    expect(formatDirStat({ ...base, n: 4, ready: 1, clean: 1, stripErrors: 2 }, true))
      .toBe('4 files · 1 ready, 1 no metadata, 2 errors');
  });

  it('says "all skipped" when the breakdown has no parts', () => {
    // ready/incompatible/clean/stripErrors all zero — formatDirStat's fallback.
    expect(formatDirStat({ ...base, n: 2 }, true)).toBe('2 files · all skipped');
  });

  it('omits the breakdown for an empty directory', () => {
    expect(formatDirStat(base, true)).toBe('0 files');
  });
});

describe('dirStatusDot', () => {
  const base = { n: 1, incompatible: 0, clean: 0, stripErrors: 0, done: 0, ready: 1 };
  it('prefers error over done', () => {
    expect(dirStatusDot({ ...base, stripErrors: 1, done: 3 })).toBe('error');
  });
  it('is done when something completed and no errors', () => {
    expect(dirStatusDot({ ...base, done: 1 })).toBe('done');
  });
  it('is none when nothing has run', () => {
    expect(dirStatusDot(base)).toBe('none');
  });
});

describe('isDirDimmed', () => {
  const base = { n: 3, incompatible: 0, clean: 0, stripErrors: 0, done: 0, ready: 3 };
  it('dims a classified dir with no ready files', () => {
    expect(isDirDimmed({ ...base, ready: 0, incompatible: 3 }, true)).toBe(true);
  });
  it('does not dim before classification', () => {
    expect(isDirDimmed({ ...base, ready: 0, incompatible: 3 }, false)).toBe(false);
  });
  it('does not dim when files are ready', () => {
    expect(isDirDimmed(base, true)).toBe(false);
  });
  it('does not dim an empty dir', () => {
    expect(isDirDimmed({ ...base, n: 0, ready: 0 }, true)).toBe(false);
  });
});
