import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetadataPreview } from '../src/lib/stripMeta';

vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(),
  },
}));

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/stripMeta');
}

function makeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['fake-image-data'], name, { type });
}

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

describe('readMetadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns nulls when exifr returns null', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result).toEqual<MetadataPreview>({
      gps: null,
      make: null,
      model: null,
      serialNumber: null,
      software: null,
      dateTime: null,
    });
  });

  it('returns nulls when exifr throws', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockRejectedValue(new Error('parse error'));

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toBeNull();
    expect(result.make).toBeNull();
  });

  it('maps GPS, make, model from raw exif data', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      latitude: 48.8566,
      longitude: 2.3522,
      Make: 'Apple',
      Model: 'iPhone 15 Pro',
      SerialNumber: 'ABC123',
      Software: 'iOS 17.0',
      DateTimeOriginal: '2024:01:15 12:00:00',
    });

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toEqual({ latitude: 48.8566, longitude: 2.3522 });
    expect(result.make).toBe('Apple');
    expect(result.model).toBe('iPhone 15 Pro');
    expect(result.serialNumber).toBe('ABC123');
    expect(result.software).toBe('iOS 17.0');
    expect(result.dateTime).toBe('2024:01:15 12:00:00');
  });

  it('returns null gps when only one coordinate is present', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ latitude: 48.8566 });

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toBeNull();
  });

  it('falls back to DateTime when DateTimeOriginal is absent', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ DateTime: '2023:06:01 08:00:00' });

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.dateTime).toBe('2023:06:01 08:00:00');
  });
});

describe('stripMetadata', () => {
  it('strips EXIF from a real JPEG and returns a smaller clean Blob', async () => {
    vi.restoreAllMocks();
    const { stripMetadata } = await importFresh();

    const file = fixtureFile('with-exif.jpg', 'image/jpeg');
    const result = await stripMetadata(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/jpeg');
    // Stripped file must be smaller (EXIF block removed)
    expect(result.size).toBeLessThan(file.size);

    // Verify no EXIF remains — parse the output bytes directly
    const buf = await result.arrayBuffer();
    const marker = new Uint8Array(buf).slice(2, 4);
    // After stripping, APP1 (0xFF 0xE1) should not immediately follow SOI
    const hasExifMarker = marker[0] === 0xFF && marker[1] === 0xE1;
    expect(hasExifMarker).toBe(false);
  });

  it('strips metadata from a PNG losslessly', async () => {
    vi.restoreAllMocks();
    const { stripMetadata } = await importFresh();

    // Build a minimal PNG with a tEXt chunk using raw bytes
    const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    // Minimal 1×1 red PNG IHDR chunk
    const IHDR = new Uint8Array([
      0, 0, 0, 13, // length
      73, 72, 68, 82, // "IHDR"
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, // 1×1, 8-bit RGB
      144, 119, 83, 222, // CRC
    ]);
    const TEXT_DATA = new TextEncoder().encode('Comment\0Hello');
    const tEXt = new Uint8Array([
      0, 0, 0, TEXT_DATA.length,
      116, 69, 88, 116, // "tEXt"
      ...TEXT_DATA,
      0, 0, 0, 0, // CRC (not validated during stripping)
    ]);
    const IDAT = new Uint8Array([
      0, 0, 0, 1, 73, 68, 65, 84, 120, 1, 0, 0, 0, // length + "IDAT" + minimal data
    ]);
    const IEND = new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]); // "IEND" + CRC

    const total = PNG_SIG.length + IHDR.length + tEXt.length + IDAT.length + IEND.length;
    const pngBytes = new Uint8Array(total);
    let pos = 0;
    for (const chunk of [PNG_SIG, IHDR, tEXt, IDAT, IEND]) {
      pngBytes.set(chunk, pos); pos += chunk.length;
    }

    const file = new File([pngBytes], 'test.png', { type: 'image/png' });
    const result = await stripMetadata(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/png');
    // tEXt chunk should be gone
    const outBytes = new Uint8Array(await result.arrayBuffer());
    const outText = new TextDecoder('latin1').decode(outBytes);
    expect(outText).not.toContain('tEXt');
    expect(outText).not.toContain('Comment');
  });
});
