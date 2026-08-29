import { describe, it, expect } from 'vitest';
import { looksLikeImage } from '../src/lib/domain/ingest';

function file(name: string, type = ''): File {
  return new File(['x'], name, { type });
}

describe('looksLikeImage', () => {
  it('accepts anything the browser typed as an image', () => {
    expect(looksLikeImage(file('photo', 'image/jpeg'))).toBe(true);
    expect(looksLikeImage(file('no-extension', 'image/webp'))).toBe(true);
  });

  it('accepts a known extension when the browser reported no type at all', () => {
    // The case that mattered: desktop browsers frequently give HEIC no MIME type,
    // and these were being dropped at ingest without a word to the user.
    expect(looksLikeImage(file('IMG_0001.heic', ''))).toBe(true);
    expect(looksLikeImage(file('IMG_0001.heif', ''))).toBe(true);
    expect(looksLikeImage(file('shot.avif', ''))).toBe(true);
  });

  it('accepts a known extension behind a wrong non-image type', () => {
    expect(looksLikeImage(file('photo.heic', 'application/octet-stream'))).toBe(true);
  });

  it('is case-insensitive about the extension', () => {
    expect(looksLikeImage(file('PHOTO.JPG', ''))).toBe(true);
    expect(looksLikeImage(file('Photo.HeIc', ''))).toBe(true);
  });

  it('rejects non-images', () => {
    expect(looksLikeImage(file('notes.txt', 'text/plain'))).toBe(false);
    expect(looksLikeImage(file('archive.zip', 'application/zip'))).toBe(false);
    expect(looksLikeImage(file('clip.mp4', 'video/mp4'))).toBe(false);
    expect(looksLikeImage(file('README', ''))).toBe(false);
  });

  it('rejects a dotfile with no extension', () => {
    expect(looksLikeImage(file('.gitignore', ''))).toBe(false);
  });

  it('does not mistake a filename containing an image word for an image', () => {
    expect(looksLikeImage(file('png-notes.txt', 'text/plain'))).toBe(false);
  });
});
