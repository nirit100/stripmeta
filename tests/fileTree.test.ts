import { describe, it, expect } from 'vitest';
import { buildTree, collectEntries, entriesUnder } from '../src/lib/fileTree';
import type { FileEntry } from '../src/lib/stripPlan';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}
function entry(path: string): FileEntry {
  const name = path.split('/').at(-1)!;
  return { file: makeFile(name), path };
}

// ─── buildTree ────────────────────────────────────────────────────────────────

describe('buildTree', () => {
  it('returns an empty root for an empty entry list', () => {
    const tree = buildTree([]);
    expect(tree.files).toHaveLength(0);
    expect(tree.subdirs.size).toBe(0);
  });

  it('places flat files (no slash) into root', () => {
    const entries = [entry('a.jpg'), entry('b.jpg')];
    const tree = buildTree(entries);
    expect(tree.files).toHaveLength(2);
    expect(tree.subdirs.size).toBe(0);
  });

  it('places a nested file under the correct subdirectory', () => {
    const e = entry('vacation/beach.jpg');
    const tree = buildTree([e]);
    expect(tree.files).toHaveLength(0);
    const dir = tree.subdirs.get('vacation')!;
    expect(dir).toBeDefined();
    expect(dir.files[0]).toBe(e);
  });

  it('sets correct path strings on subdirectories', () => {
    const tree = buildTree([entry('a/b/c.jpg')]);
    const a = tree.subdirs.get('a')!;
    const b = a.subdirs.get('b')!;
    expect(a.path).toBe('a');
    expect(b.path).toBe('a/b');
  });

  it('groups multiple files in the same directory', () => {
    const entries = [entry('dir/a.jpg'), entry('dir/b.jpg')];
    const tree = buildTree(entries);
    expect(tree.subdirs.get('dir')!.files).toHaveLength(2);
  });

  it('handles multiple top-level directories', () => {
    const entries = [entry('foo/a.jpg'), entry('bar/b.jpg')];
    const tree = buildTree(entries);
    expect(tree.subdirs.size).toBe(2);
    expect(tree.subdirs.has('foo')).toBe(true);
    expect(tree.subdirs.has('bar')).toBe(true);
  });

  it('mixes root-level files and subdirectories', () => {
    const flat = entry('flat.jpg');
    const nested = entry('dir/nested.jpg');
    const tree = buildTree([flat, nested]);
    expect(tree.files).toContain(flat);
    expect(tree.subdirs.size).toBe(1);
  });
});

// ─── collectEntries ───────────────────────────────────────────────────────────

describe('collectEntries', () => {
  it('returns an empty array for an empty tree', () => {
    expect(collectEntries(buildTree([]))).toHaveLength(0);
  });

  it('returns root-level files', () => {
    const entries = [entry('a.jpg'), entry('b.jpg')];
    expect(collectEntries(buildTree(entries))).toHaveLength(2);
  });

  it('collects files recursively from nested subdirs', () => {
    const entries = [entry('root.jpg'), entry('dir/nested.jpg'), entry('dir/sub/deep.jpg')];
    const result = collectEntries(buildTree(entries));
    expect(result).toHaveLength(3);
  });

  it('preserves FileEntry identity', () => {
    const e = entry('vacation/photo.jpg');
    const result = collectEntries(buildTree([e]));
    expect(result[0]).toBe(e);
  });
});

// ─── entriesUnder ─────────────────────────────────────────────────────────────

describe('entriesUnder', () => {
  it('returns entries whose path starts with the given prefix + /', () => {
    const a = entry('vacation/beach.jpg');
    const b = entry('vacation/mountain.jpg');
    const c = entry('other/photo.jpg');
    const result = entriesUnder([a, b, c], 'vacation');
    expect(result).toContain(a);
    expect(result).toContain(b);
    expect(result).not.toContain(c);
  });

  it('does not match a file at exactly the given path (no slash)', () => {
    const e: FileEntry = { file: makeFile('vacation'), path: 'vacation' };
    expect(entriesUnder([e], 'vacation')).toHaveLength(0);
  });

  it('returns empty when no entries match', () => {
    const e = entry('other/photo.jpg');
    expect(entriesUnder([e], 'vacation')).toHaveLength(0);
  });

  it('does not match partial directory names', () => {
    const e = entry('vacationextra/photo.jpg');
    expect(entriesUnder([e], 'vacation')).toHaveLength(0);
  });

  it('works for deeply nested paths', () => {
    const e = entry('a/b/c/photo.jpg');
    expect(entriesUnder([e], 'a/b')).toContain(e);
    expect(entriesUnder([e], 'a')).toContain(e);
    expect(entriesUnder([e], 'a/b/c')).toContain(e);
  });
});
