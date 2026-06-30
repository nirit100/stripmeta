import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, entriesNewerThan, type ChangelogEntry } from '../src/lib/util/changelog.ts';

const entry = (version: string): ChangelogEntry => ({ version, date: '', notes: null, sections: [] });

describe('parseVersion', () => {
  it('tolerates a leading v and a git-describe suffix', () => {
    expect(parseVersion('v0.5.4')).toEqual([0, 5, 4]);
    expect(parseVersion('0.5.4-2-gabc123')).toEqual([0, 5, 4]);
    expect(parseVersion('dev')).toEqual([0, 0, 0]);
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('0.5.4', '0.5.3')).toBeGreaterThan(0);
    expect(compareVersions('0.5.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });
});

describe('entriesNewerThan', () => {
  const entries = [entry('0.5.4'), entry('0.5.3'), entry('0.5.2')];

  it('returns only entries newer than seen, newest first', () => {
    expect(entriesNewerThan(entries, '0.5.2').map(e => e.version)).toEqual(['0.5.4', '0.5.3']);
  });

  it('returns none on a first visit (no seen version)', () => {
    expect(entriesNewerThan(entries, null)).toEqual([]);
  });

  it('returns none when already on the latest', () => {
    expect(entriesNewerThan(entries, '0.5.4')).toEqual([]);
  });
});
