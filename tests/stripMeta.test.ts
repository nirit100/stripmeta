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

describe('StripperManager.classify', () => {
  function makeTypedFile(name: string, type: string): File {
    return new File(['x'], name, { type });
  }

  it('returns none for JPEG', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.jpg', 'image/jpeg'))).toBe('none');
  });

  it('returns none for PNG', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.png', 'image/png'))).toBe('none');
  });

  it('returns none for WebP', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.webp', 'image/webp'))).toBe('none');
  });

  it('returns lossy for GIF', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.gif', 'image/gif'))).toBe('lossy');
  });

  it('returns lossy for BMP', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.bmp', 'image/bmp'))).toBe('lossy');
  });

  it('returns lossy for SVG', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.svg', 'image/svg+xml'))).toBe('lossy');
  });

  it('returns lossy for AVIF', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.avif', 'image/avif'))).toBe('lossy');
  });

  it('returns unsupported for HEIC', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.heic', 'image/heic'))).toBe('unsupported');
  });

  it('returns unsupported for HEIF', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.heif', 'image/heif'))).toBe('unsupported');
  });

  it('returns unsupported for unknown type', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.raw', 'image/x-raw'))).toBe('unsupported');
  });

  it('classifies a real GIF fixture as lossy', async () => {
    vi.restoreAllMocks();
    const { defaultStripperManager } = await importFresh();
    const file = fixtureFile('test.gif', 'image/gif');
    expect(await defaultStripperManager.classify(file)).toBe('lossy');
  });
});

describe('stripMetadata', () => {
  describe('JPEG', () => {
    it('removes EXIF and returns a smaller blob', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.jpg', 'image/jpeg');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      expect(out[0]).toBe(0xFF);
      expect(out[1]).toBe(0xD8); // SOI marker
      expect(out[out.length - 2]).toBe(0xFF);
      expect(out[out.length - 1]).toBe(0xD9); // EOI marker
      expect(out[2] === 0xFF && out[3] === 0xE1).toBe(false); // no APP1/EXIF
    });

    it('preserves all non-EXIF markers', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.jpg', 'image/jpeg');
      const result = await stripMetadata(file);

      const out = new Uint8Array(await result.arrayBuffer());
      // SOS marker (FF DA) must still be present — marks start of scan/image data
      const hasImageData = out.some((b, i) => b === 0xFF && out[i + 1] === 0xDA);
      expect(hasImageData).toBe(true);
    });

    it('is idempotent — stripping twice gives the same size', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.jpg', 'image/jpeg');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });

  describe('PNG', () => {
    it('removes iTXt chunks and returns a smaller blob', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/png');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      expect(Array.from(out.slice(0, 8))).toEqual(PNG_SIG);

      const outText = new TextDecoder('latin1').decode(out);
      expect(outText).not.toContain('iTXt');
      expect(outText).not.toContain('tEXt');
    });

    it('preserves IHDR and IDAT chunks', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const result = await stripMetadata(file);

      const outText = new TextDecoder('latin1').decode(new Uint8Array(await result.arrayBuffer()));
      expect(outText).toContain('IHDR');
      expect(outText).toContain('IDAT');
      expect(outText).toContain('IEND');
    });

    it('is idempotent — stripping twice gives the same size', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });

  describe('WebP', () => {
    it('removes EXIF chunk and clears VP8X EXIF flag', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/webp');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      const ascii = (s: Uint8Array) => new TextDecoder('ascii').decode(s);
      expect(ascii(out.slice(0, 4))).toBe('RIFF');
      expect(ascii(out.slice(8, 12))).toBe('WEBP');
      expect(new TextDecoder('latin1').decode(out)).not.toContain('EXIF');
      expect(out[20] & 0x08).toBe(0); // VP8X EXIF flag cleared
    });

    it('preserves VP8 image data', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const result = await stripMetadata(file);

      const outText = new TextDecoder('latin1').decode(new Uint8Array(await result.arrayBuffer()));
      expect(outText).toContain('VP8');
    });

    it('is idempotent — stripping twice gives the same size', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });
});
