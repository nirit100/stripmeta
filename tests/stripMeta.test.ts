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

  it('strips iTXt metadata from a real PNG losslessly', async () => {
    vi.restoreAllMocks();
    const { stripMetadata } = await importFresh();

    // test.png from png-chunks-extract — contains IHDR, iCCP, pHYs, iTXt, IDAT×4, IEND
    const file = fixtureFile('test.png', 'image/png');
    const result = await stripMetadata(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/png');
    expect(result.size).toBeLessThan(file.size);

    // Verify iTXt chunk is gone from output
    const outBytes = new Uint8Array(await result.arrayBuffer());
    const outText = new TextDecoder('latin1').decode(outBytes);
    expect(outText).not.toContain('iTXt');
  });

  it('strips EXIF chunk from a real WebP losslessly', async () => {
    vi.restoreAllMocks();
    const { stripMetadata } = await importFresh();

    const file = fixtureFile('with-exif.webp', 'image/webp');
    const result = await stripMetadata(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/webp');
    expect(result.size).toBeLessThan(file.size);

    const outBytes = new Uint8Array(await result.arrayBuffer());
    const outText = new TextDecoder('latin1').decode(outBytes);
    expect(outText).not.toContain('EXIF');
    // VP8X flags byte should have EXIF bit (0x08) cleared
    const vp8xFlagsOffset = 20; // 12 RIFF header + 8 VP8X chunk header
    expect(outBytes[vp8xFlagsOffset] & 0x08).toBe(0);
  });
});
