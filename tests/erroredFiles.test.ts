import { describe, it, expect, beforeEach } from 'vitest';
import { registerErroredFile, clearErroredFiles, getErroredFiles } from '../src/lib/erroredFiles';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

beforeEach(() => clearErroredFiles());

describe('getErroredFiles', () => {
  it('returns an empty list initially', () => {
    expect(getErroredFiles()).toHaveLength(0);
  });

  it('returns a copy — mutations do not affect internal state', () => {
    registerErroredFile(makeFile(), 'photo.jpg');
    const copy = getErroredFiles();
    copy.pop();
    expect(getErroredFiles()).toHaveLength(1);
  });
});

describe('registerErroredFile', () => {
  it('adds a file with its path', () => {
    const f = makeFile('a.jpg');
    registerErroredFile(f, 'folder/a.jpg');
    const [entry] = getErroredFiles();
    expect(entry!.file).toBe(f);
    expect(entry!.path).toBe('folder/a.jpg');
  });

  it('accumulates multiple files in insertion order', () => {
    const f1 = makeFile('a.jpg');
    const f2 = makeFile('b.jpg');
    registerErroredFile(f1, 'a.jpg');
    registerErroredFile(f2, 'b.jpg');
    const result = getErroredFiles();
    expect(result).toHaveLength(2);
    expect(result[0]!.file).toBe(f1);
    expect(result[1]!.file).toBe(f2);
  });

  it('allows the same file to be registered more than once', () => {
    const f = makeFile();
    registerErroredFile(f, 'photo.jpg');
    registerErroredFile(f, 'photo.jpg');
    expect(getErroredFiles()).toHaveLength(2);
  });
});

describe('clearErroredFiles', () => {
  it('empties a non-empty list', () => {
    registerErroredFile(makeFile(), 'photo.jpg');
    clearErroredFiles();
    expect(getErroredFiles()).toHaveLength(0);
  });

  it('is safe to call on an already-empty list', () => {
    expect(() => clearErroredFiles()).not.toThrow();
    expect(getErroredFiles()).toHaveLength(0);
  });

  it('does not affect subsequent registrations', () => {
    registerErroredFile(makeFile('a.jpg'), 'a.jpg');
    clearErroredFiles();
    const f = makeFile('b.jpg');
    registerErroredFile(f, 'b.jpg');
    const result = getErroredFiles();
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe(f);
  });
});
