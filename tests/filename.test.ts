import { describe, it, expect } from 'vitest';
import { splitFilename } from '../src/lib/util/filename';

// Invariant: head + tail always reconstructs the original name.
function roundtrips(name: string, tailLen?: number): boolean {
  const { head, tail } = splitFilename(name, tailLen);
  return head + tail === name;
}

describe('splitFilename', () => {
  it('keeps the last 4 basename chars + extension in the tail', () => {
    expect(splitFilename('vacation.jpg')).toEqual({ head: 'vaca', tail: 'tion.jpg' });
  });

  it('puts everything in the tail when the basename is <= tailLen', () => {
    expect(splitFilename('img.png')).toEqual({ head: '', tail: 'img.png' });
    expect(splitFilename('ab.png')).toEqual({ head: '', tail: 'ab.png' });
  });

  it('handles names with no extension', () => {
    expect(splitFilename('README')).toEqual({ head: 'RE', tail: 'ADME' });
    expect(splitFilename('abc')).toEqual({ head: '', tail: 'abc' });
  });

  it('treats a leading dot as part of the basename (dotfiles have no extension)', () => {
    expect(splitFilename('.gitignore')).toEqual({ head: '.gitig', tail: 'nore' });
  });

  it('treats a trailing dot as having no extension', () => {
    expect(splitFilename('weird.')).toEqual({ head: 'we', tail: 'ird.' });
  });

  it('uses the last dot for multi-dot names', () => {
    expect(splitFilename('photo.final.heic')).toEqual({ head: 'photo.f', tail: 'inal.heic' });
  });

  it('respects a custom tailLen', () => {
    expect(splitFilename('vacation.jpg', 2)).toEqual({ head: 'vacati', tail: 'on.jpg' });
  });

  it('round-trips head + tail back to the original name', () => {
    for (const name of ['vacation.jpg', 'img.png', 'README', '.gitignore', 'weird.', 'photo.final.heic', 'a', '']) {
      expect(roundtrips(name)).toBe(true);
    }
  });
});
