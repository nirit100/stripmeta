import { describe, it, expect } from 'vitest';
import { FileStore } from '../src/lib/state/fileStore';
import type { FileEntry } from '../src/lib/domain/stripPlan';
import type { SkipSettings } from '../src/lib/domain/skip';
import type { MetadataPreview } from '../src/lib/stripMeta';

let seq = 0;
function entry(path = `f${seq++}.jpg`): FileEntry {
  return { file: new File(['x'], path.split('/').at(-1)!, { type: 'image/jpeg' }), path };
}
const allOff: SkipSettings = { paranoid: false, skipUnsupported: false, skipExperimental: false, skipClean: false };
const emptyMeta: MetadataPreview = {
  gps: null, make: null, model: null, serialNumber: null, software: null,
  dateTime: null, artist: null, userComment: null, hasAnyMetadata: false,
};

describe('FileStore.add', () => {
  it('appends fresh entries and reports size/empty', () => {
    const s = new FileStore();
    expect(s.isEmpty).toBe(true);
    const a = entry(), b = entry();
    expect(s.add([a, b])).toEqual([a, b]);
    expect(s.size).toBe(2);
    expect(s.isEmpty).toBe(false);
    expect(s.entries).toEqual([a, b]);
  });

  it('dedups by File identity and returns only the newly added', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    const b = entry();
    expect(s.add([a, b])).toEqual([b]); // a already present
    expect(s.size).toBe(2);
  });
});

describe('FileStore classification + previews', () => {
  it('exposes level and canConvertPng once classified', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    expect(s.classified).toBe(false);
    s.setClassification(new Map([[a.file, { level: 'lossy', canConvertPng: true }]]));
    expect(s.classified).toBe(true);
    expect(s.level(a.file)).toBe('lossy');
    expect(s.canConvertPng(a.file)).toBe(true);
  });

  it('preserves previews across re-classification', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'none', canConvertPng: false }]]));
    s.setPreview(a.file, { ...emptyMeta, make: 'Canon', hasAnyMetadata: true });
    // Re-classify (e.g. paranoid toggle) — preview must survive.
    s.setClassification(new Map([[a.file, { level: 'lossy', canConvertPng: true }]]));
    expect(s.level(a.file)).toBe('lossy');
    expect(s.preview(a.file)?.make).toBe('Canon');
  });

  it('drops models for files no longer in the classification set', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'none', canConvertPng: false }]]));
    s.setClassification(new Map()); // re-render with a gone
    expect(s.level(a.file)).toBeUndefined();
  });

  it('defaults getters for unknown files', () => {
    const s = new FileStore();
    const ghost = new File(['x'], 'x.jpg');
    expect(s.level(ghost)).toBeUndefined();
    expect(s.canConvertPng(ghost)).toBe(false);
    expect(s.preview(ghost)).toBeUndefined();
  });
});

describe('FileStore.skipReason', () => {
  it('returns the reason from getSkipReason using the store maps', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'unsupported', canConvertPng: false }]]));
    expect(s.skipReason(a.file, { ...allOff, skipUnsupported: true })).toBe('unsupported');
    expect(s.skipReason(a.file, allOff)).toBeNull();
  });

  it('honours skipClean against the stored preview', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'none', canConvertPng: true }]]));
    s.setPreview(a.file, emptyMeta); // no metadata
    expect(s.skipReason(a.file, { ...allOff, skipClean: true })).toBe('no-metadata');
  });
});

describe('FileStore aggregates', () => {
  function classified(): FileStore {
    const s = new FileStore();
    const lossy = entry(), unsup = entry(), exp = entry(), none = entry();
    s.add([lossy, unsup, exp, none]);
    s.setClassification(new Map([
      [lossy.file, { level: 'lossy', canConvertPng: true }],
      [unsup.file, { level: 'unsupported', canConvertPng: false }],
      [exp.file, { level: 'experimental', canConvertPng: true }],
      [none.file, { level: 'none', canConvertPng: true }],
    ]));
    return s;
  }

  it('bannerCounts tallies per level', () => {
    expect(classified().bannerCounts()).toEqual({ lossy: 1, unsupported: 1, experimental: 1 });
  });

  it('dirStats counts files under a path', () => {
    const s = new FileStore();
    const a: FileEntry = { file: new File(['x'], 'a.jpg'), path: 'trip/a.jpg' };
    const b: FileEntry = { file: new File(['x'], 'b.jpg'), path: 'trip/b.jpg' };
    const other: FileEntry = { file: new File(['x'], 'c.jpg'), path: 'other/c.jpg' };
    s.add([a, b, other]);
    s.setClassification(new Map([
      [a.file, { level: 'none', canConvertPng: true }],
      [b.file, { level: 'unsupported', canConvertPng: false }],
      [other.file, { level: 'none', canConvertPng: true }],
    ]));
    const stats = s.dirStats('trip', { ...allOff, skipUnsupported: true });
    expect(stats.n).toBe(2);
    expect(stats.incompatible).toBe(1);
    expect(stats.ready).toBe(1);
  });

  it('isFlat reflects directory paths', () => {
    const s = new FileStore();
    s.add([entry('a.jpg')]);
    expect(s.isFlat()).toBe(true);
    s.add([{ file: new File(['x'], 'd.jpg'), path: 'dir/d.jpg' }]);
    expect(s.isFlat()).toBe(false);
  });

  it('flatSorted sinks skipped files below ready ones', () => {
    const s = new FileStore();
    const ready = entry('go.jpg'), skip = entry('no.jpg');
    s.add([skip, ready]);
    s.setClassification(new Map([
      [ready.file, { level: 'none', canConvertPng: true }],
      [skip.file, { level: 'unsupported', canConvertPng: false }],
    ]));
    const order = s.flatSorted({ ...allOff, skipUnsupported: true }).map(e => e.path);
    expect(order).toEqual(['go.jpg', 'no.jpg']);
  });

  it('hasPendingStrippable tracks unstripped ready files', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'none', canConvertPng: true }]]));
    expect(s.hasPendingStrippable(allOff)).toBe(true);
    s.strip.markDone(a.file, new Blob(['y']));
    expect(s.hasPendingStrippable(allOff)).toBe(false);
  });
});

describe('FileStore removal', () => {
  it('remove() clears the entry, its model, and its strip state', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'none', canConvertPng: true }]]));
    s.strip.markDone(a.file, new Blob(['y']));
    s.remove(a);
    expect(s.size).toBe(0);
    expect(s.level(a.file)).toBeUndefined();
    expect(s.strip.done.has(a.file)).toBe(false);
    expect(s.strip.blobs.has(a.file)).toBe(false);
  });

  it('removeFiles() drops a whole set of files', () => {
    const s = new FileStore();
    const a = entry(), b = entry(), keep = entry();
    s.add([a, b, keep]);
    s.removeFiles([a.file, b.file]);
    expect(s.entries).toEqual([keep]);
  });

  it('clear() resets entries, models, and strip state', () => {
    const s = new FileStore();
    const a = entry();
    s.add([a]);
    s.setClassification(new Map([[a.file, { level: 'lossy', canConvertPng: true }]]));
    s.strip.markDone(a.file, new Blob(['y']));
    s.clear();
    expect(s.isEmpty).toBe(true);
    expect(s.classified).toBe(false);
    expect(s.strip.done.size).toBe(0);
  });
});
