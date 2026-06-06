import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetadataPreview } from '../src/lib/stripMeta';

vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(),
    gps: vi.fn(),
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
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

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
    vi.mocked(exifr.default.gps).mockRejectedValue(new Error('gps error'));

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toBeNull();
    expect(result.make).toBeNull();
  });

  it('maps GPS, make, model from raw exif data', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      Make: 'Apple',
      Model: 'iPhone 15 Pro',
      SerialNumber: 'ABC123',
      Software: 'iOS 17.0',
      DateTimeOriginal: '2024:01:15 12:00:00',
    });
    vi.mocked(exifr.default.gps).mockResolvedValue({ latitude: 48.8566, longitude: 2.3522 });

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toEqual({ latitude: 48.8566, longitude: 2.3522 });
    expect(result.make).toBe('Apple');
    expect(result.model).toBe('iPhone 15 Pro');
    expect(result.serialNumber).toBe('ABC123');
    expect(result.software).toBe('iOS 17.0');
    expect(result.dateTime).toBe('2024:01:15 12:00:00');
  });

  it('returns null gps when only latitude is present', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({});
    vi.mocked(exifr.default.gps).mockResolvedValue({ latitude: 48.8566 } as never);

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());

    expect(result.gps).toBeNull();
  });

  it('falls back to DateTime when DateTimeOriginal is absent', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ DateTime: '2023:06:01 08:00:00' });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

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
    expect(result.size).toBeLessThan(file.size);

    const buf = await result.arrayBuffer();
    const marker = new Uint8Array(buf).slice(2, 4);
    const hasExifMarker = marker[0] === 0xFF && marker[1] === 0xE1;
    expect(hasExifMarker).toBe(false);
  });

  it('strips iTXt metadata from a real PNG losslessly', async () => {
    vi.restoreAllMocks();
    const { stripMetadata } = await importFresh();

    const file = fixtureFile('test.png', 'image/png');
    const result = await stripMetadata(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/png');
    expect(result.size).toBeLessThan(file.size);

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
    const vp8xFlagsOffset = 20;
    expect(outBytes[vp8xFlagsOffset] & 0x08).toBe(0);
  });
});
