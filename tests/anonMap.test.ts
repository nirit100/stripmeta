import { describe, it, expect } from 'vitest';
import { buildAnonMap } from '../src/lib/domain/anonMap.ts';
import type { LogEntry } from '../src/scripts/logger.ts';

function entry(filePath: string): LogEntry {
  return { level: 'error', fileName: filePath.split(/[\\/]/).pop()!, filePath, message: 'err' };
}

describe('buildAnonMap', () => {
  it('anonymizes a bare filename, preserving extension', () => {
    const map = buildAnonMap([entry('photo.jpg')]);
    expect(map.get('photo.jpg')).toBe('image_1.jpg');
  });

  it('anonymizes a path, preserving folder depth', () => {
    const map = buildAnonMap([entry('vacation/paris/photo.jpg')]);
    expect(map.get('vacation/paris/photo.jpg')).toBe('folder_1/folder_2/image_1.jpg');
  });

  it('preserves structure: two files in the same folder share the same folder placeholder', () => {
    const map = buildAnonMap([
      entry('trip/a.jpg'),
      entry('trip/b.png'),
    ]);
    const [aFolder] = map.get('trip/a.jpg')!.split('/');
    const [bFolder] = map.get('trip/b.png')!.split('/');
    expect(aFolder).toBe(bFolder);
    expect(map.get('trip/a.jpg')).toBe('folder_1/image_1.jpg');
    expect(map.get('trip/b.png')).toBe('folder_1/image_2.png');
  });

  it('gives different folder placeholders to different folders', () => {
    const map = buildAnonMap([
      entry('paris/photo.jpg'),
      entry('berlin/photo.jpg'),
    ]);
    expect(map.get('paris/photo.jpg')).toBe('folder_1/image_1.jpg');
    expect(map.get('berlin/photo.jpg')).toBe('folder_2/image_1.jpg');
  });

  it('maps the same path consistently across multiple log entries', () => {
    const e = entry('trip/photo.jpg');
    const map = buildAnonMap([e, e, e]);
    expect(map.size).toBe(1);
    expect(map.get('trip/photo.jpg')).toBe('folder_1/image_1.jpg');
  });

  it('falls back to filePath over fileName', () => {
    const e: LogEntry = { level: 'error', fileName: 'photo.jpg', filePath: 'trip/photo.jpg', message: 'err' };
    const map = buildAnonMap([e]);
    expect(map.has('trip/photo.jpg')).toBe(true);
    expect(map.has('photo.jpg')).toBe(false);
  });

  it('uses fileName when filePath is empty', () => {
    const e: LogEntry = { level: 'warning', fileName: 'photo.jpg', filePath: '', message: 'err' };
    const map = buildAnonMap([e]);
    expect(map.get('photo.jpg')).toBe('image_1.jpg');
  });

  it('handles files without an extension', () => {
    const map = buildAnonMap([entry('trip/photofile')]);
    expect(map.get('trip/photofile')).toBe('folder_1/image_1');
  });

  it('normalises extension to lowercase', () => {
    const map = buildAnonMap([entry('PHOTO.JPG')]);
    expect(map.get('PHOTO.JPG')).toBe('image_1.jpg');
  });

  it('handles Windows-style backslash paths', () => {
    const map = buildAnonMap([entry('vacation\\paris\\photo.jpg')]);
    expect(map.get('vacation\\paris\\photo.jpg')).toBe('folder_1/folder_2/image_1.jpg');
  });

  it('numbers files sequentially across different folders', () => {
    const map = buildAnonMap([
      entry('a/first.jpg'),
      entry('b/second.jpg'),
      entry('c/third.jpg'),
    ]);
    expect(map.get('a/first.jpg')).toBe('folder_1/image_1.jpg');
    expect(map.get('b/second.jpg')).toBe('folder_2/image_2.jpg');
    expect(map.get('c/third.jpg')).toBe('folder_3/image_3.jpg');
  });

  it('returns an empty map for empty input', () => {
    expect(buildAnonMap([])).toEqual(new Map());
  });
});
