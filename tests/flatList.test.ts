import { describe, it, expect } from 'vitest';
import { isFlatMode, sortForFlatList, type FlatSortDeps } from '../src/lib/flatList';
import type { FileEntry } from '../src/lib/stripPlan';
import type { WarningLevel } from '../src/lib/strippers/types';
import type { SkipReason } from '../src/lib/skip';

function entry(path: string): FileEntry {
  return { file: new File(['x'], path.split('/').at(-1)!, { type: 'image/jpeg' }), path };
}

describe('isFlatMode', () => {
  it('is true when no entry has a directory path', () => {
    expect(isFlatMode([entry('a.jpg'), entry('b.png')])).toBe(true);
  });
  it('is true for an empty list', () => {
    expect(isFlatMode([])).toBe(true);
  });
  it('is false when any entry is under a directory', () => {
    expect(isFlatMode([entry('a.jpg'), entry('trip/b.png')])).toBe(false);
  });
});

describe('sortForFlatList', () => {
  function deps(skip: Map<FileEntry, SkipReason | null>, levels: Map<FileEntry, WarningLevel>): FlatSortDeps {
    return {
      skipReason: f => [...skip].find(([e]) => e.file === f)?.[1] ?? null,
      levelOf: new Map([...levels].map(([e, l]) => [e.file, l])),
    };
  }

  it('sinks skipped files below strippable ones', () => {
    const skipped = entry('skip.jpg'), ready = entry('go.jpg');
    const out = sortForFlatList([skipped, ready], deps(
      new Map([[skipped, 'no-metadata'], [ready, null]]),
      new Map([[skipped, 'none'], [ready, 'none']]),
    ));
    expect(out.map(e => e.path)).toEqual(['go.jpg', 'skip.jpg']);
  });

  it('orders by warning level within the same skip bucket', () => {
    const none = entry('n.jpg'), lossy = entry('l.jpg'), exp = entry('e.heic'), unsup = entry('u.xyz');
    const all = [none, exp, unsup, lossy];
    const out = sortForFlatList(all, deps(
      new Map(all.map(e => [e, null])),
      new Map([[none, 'none'], [lossy, 'lossy'], [exp, 'experimental'], [unsup, 'unsupported']]),
    ));
    // unsupported(0) < lossy(1) < experimental(2) < none(3)
    expect(out.map(e => e.path)).toEqual(['u.xyz', 'l.jpg', 'e.heic', 'n.jpg']);
  });

  it('does not mutate the input array', () => {
    const a = entry('a.jpg'), b = entry('b.jpg');
    const input = [a, b];
    sortForFlatList(input, deps(new Map([[a, 'lossy'], [b, null]]), new Map([[a, 'lossy'], [b, 'none']])));
    expect(input).toEqual([a, b]);
  });

  it('defaults missing levels to "none"', () => {
    const a = entry('a.jpg'), b = entry('b.jpg');
    const out = sortForFlatList([a, b], { skipReason: () => null, levelOf: new Map() });
    expect(out).toHaveLength(2); // no throw; both treated as 'none'
  });
});
