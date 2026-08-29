import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectFormat, detectFormatFromHeader, isIsobmff, isUnexpectedlyUndetected,
} from '../src/lib/format/detect';

function fixture(name: string, type = ''): File {
  return new File([readFileSync(join(import.meta.dirname, 'fixtures', name))], name, { type });
}

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

/** ftyp box: [size][ftyp][major][minor][...compatible] */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  return bytes(
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0,
    ...compatible.flatMap(b => ascii(b)),
  );
}

describe('detectFormat on real fixtures', () => {
  it.each([
    ['with-exif.jpg', 'jpeg'],
    ['rich-metadata.jpg', 'jpeg'],
    ['test.png', 'png'],
    ['test.gif', 'gif'],
    ['with-exif.webp', 'webp'],
    ['heic_sample_file_50KB.heic', 'heic'],
    ['blue-avif-12bit.avif', 'avif'],
  ])('identifies %s as %s', async (name, expected) => {
    expect((await detectFormat(fixture(name))).format).toBe(expected);
  });

  it('groups both ISOBMFF formats for the metadata reader', async () => {
    expect(isIsobmff((await detectFormat(fixture('heic_sample_file_50KB.heic'))).format)).toBe(true);
    expect(isIsobmff((await detectFormat(fixture('blue-avif-12bit.avif'))).format)).toBe(true);
    expect(isIsobmff((await detectFormat(fixture('test.png'))).format)).toBe(false);
  });

  it('ignores a lying MIME type entirely', async () => {
    const liar = new File(
      [readFileSync(join(import.meta.dirname, 'fixtures', 'with-exif.webp'))],
      'actually-a-webp.png', { type: 'image/png' });
    expect((await detectFormat(liar)).format).toBe('webp');
  });
});

describe('detectFormatFromHeader', () => {
  it('detects JPEG', () => {
    expect(detectFormatFromHeader(bytes(0xFF, 0xD8, 0xFF, 0xE0)).format).toBe('jpeg');
  });

  it('requires the full 8-byte PNG signature', () => {
    expect(detectFormatFromHeader(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)).format).toBe('png');
    // Right first four bytes, wrong terminator — not a PNG.
    expect(detectFormatFromHeader(bytes(0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0)).format).toBe('unknown');
  });

  it('requires both RIFF and WEBP for WebP', () => {
    expect(detectFormatFromHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'))).format).toBe('webp');
    expect(detectFormatFromHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE'))).format).toBe('unknown');
  });

  it('detects GIF87a and GIF89a', () => {
    expect(detectFormatFromHeader(bytes(...ascii('GIF87a'))).format).toBe('gif');
    expect(detectFormatFromHeader(bytes(...ascii('GIF89a'))).format).toBe('gif');
    expect(detectFormatFromHeader(bytes(...ascii('GIF8XX'))).format).toBe('unknown');
  });

  it('detects BMP and both TIFF byte orders', () => {
    expect(detectFormatFromHeader(bytes(0x42, 0x4D, 0, 0)).format).toBe('bmp');
    expect(detectFormatFromHeader(bytes(0x49, 0x49, 0x2A, 0x00)).format).toBe('tiff'); // little-endian
    expect(detectFormatFromHeader(bytes(0x4D, 0x4D, 0x00, 0x2A)).format).toBe('tiff'); // big-endian
  });

  it('returns unknown for a short or empty header', () => {
    expect(detectFormatFromHeader(bytes()).format).toBe('unknown');
    expect(detectFormatFromHeader(bytes(0xFF, 0xD8)).format).toBe('unknown');
  });
});

describe('ftyp brands', () => {
  it('collects the major brand first, then the compatible brands', () => {
    expect(detectFormatFromHeader(ftyp('avif', 'mif1', 'miaf')).brands).toEqual(['avif', 'mif1', 'miaf']);
  });

  it('resolves an AVIF whose major brand is the generic mif1', () => {
    // mif1 is in the HEIC brand set too, so this only comes out right because
    // the ambiguity is settled here rather than by handler registration order.
    expect(detectFormatFromHeader(ftyp('mif1', 'avif', 'miaf')).format).toBe('avif');
  });

  it('treats a bare mif1 with no avif brand as HEIF', () => {
    expect(detectFormatFromHeader(ftyp('mif1', 'heic')).format).toBe('heic');
  });

  it('reports an ftyp box whose brands identify nothing as unknown', () => {
    expect(detectFormatFromHeader(ftyp('qt  ', 'isom')).format).toBe('unknown');
  });

  it('does not read past the declared box size', () => {
    const d = detectFormatFromHeader(ftyp('heic')); // no compatible brands
    expect(d.brands).toEqual(['heic']);
  });
});

describe('resolved mime', () => {
  const jpeg = bytes(0xFF, 0xD8, 0xFF, 0xE0);
  const nothing = bytes(0x00, 0x01, 0x02, 0x03);

  it('uses the type the bytes imply, ignoring the reported one', () => {
    expect(detectFormatFromHeader(jpeg, 'image/png').mime).toBe('image/jpeg');
    expect(detectFormatFromHeader(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')), 'image/png').mime)
      .toBe('image/webp');
  });

  it('gives the ISOBMFF formats their own types', () => {
    expect(detectFormatFromHeader(ftyp('avif'), '').mime).toBe('image/avif');
    expect(detectFormatFromHeader(ftyp('heic'), '').mime).toBe('image/heic');
  });

  it('falls back to the reported type only when the bytes say nothing', () => {
    // SVG is the case that matters: text, so it can never be sniffed, and the
    // canvas handler can only recognise it through this fallback.
    expect(detectFormatFromHeader(nothing, 'image/svg+xml').mime).toBe('image/svg+xml');
    expect(detectFormatFromHeader(nothing, '').mime).toBe('application/octet-stream');
  });
});

describe('isUnexpectedlyUndetected', () => {
  it('flags an unidentifiable file so it can be reported', () => {
    expect(isUnexpectedlyUndetected({ format: 'unknown', mime: 'image/png' })).toBe(true);
    expect(isUnexpectedlyUndetected({ format: 'unknown', mime: 'application/octet-stream' })).toBe(true);
  });

  it('does not flag SVG, which legitimately has no magic number', () => {
    expect(isUnexpectedlyUndetected({ format: 'unknown', mime: 'image/svg+xml' })).toBe(false);
  });

  it('never flags a file that was identified', () => {
    expect(isUnexpectedlyUndetected({ format: 'jpeg', mime: 'image/jpeg' })).toBe(false);
  });
});
