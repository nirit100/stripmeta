import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('exifr', () => ({
  default: { parse: vi.fn(), gps: vi.fn() },
}));

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/stripMeta');
}

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

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
      expect(out[1]).toBe(0xD8);
      expect(out[out.length - 2]).toBe(0xFF);
      expect(out[out.length - 1]).toBe(0xD9);
      expect(out[2] === 0xFF && out[3] === 0xE1).toBe(false); // no APP1/EXIF marker
    });

    it('preserves image data (SOS marker present)', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.jpg', 'image/jpeg');
      const out = new Uint8Array(await (await stripMetadata(file)).arrayBuffer());
      expect(out.some((b, i) => b === 0xFF && out[i + 1] === 0xDA)).toBe(true);
    });

    it('is idempotent', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.jpg', 'image/jpeg');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });

  describe('PNG', () => {
    it('removes metadata chunks and returns a smaller blob', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/png');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      expect(Array.from(out.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

      const text = new TextDecoder('latin1').decode(out);
      expect(text).not.toContain('iTXt');
      expect(text).not.toContain('tEXt');
    });

    it('preserves IHDR, IDAT, IEND chunks', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const text = new TextDecoder('latin1').decode(new Uint8Array(await (await stripMetadata(file)).arrayBuffer()));
      expect(text).toContain('IHDR');
      expect(text).toContain('IDAT');
      expect(text).toContain('IEND');
    });

    it('is idempotent', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('test.png', 'image/png');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });

  describe('WebP', () => {
    it('removes EXIF chunk and clears VP8X flag', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/webp');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      const ascii = (b: Uint8Array) => new TextDecoder('ascii').decode(b);
      expect(ascii(out.slice(0, 4))).toBe('RIFF');
      expect(ascii(out.slice(8, 12))).toBe('WEBP');
      expect(new TextDecoder('latin1').decode(out)).not.toContain('EXIF');
      expect(out[20] & 0x08).toBe(0);
    });

    it('preserves VP8 image data', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const text = new TextDecoder('latin1').decode(new Uint8Array(await (await stripMetadata(file)).arrayBuffer()));
      expect(text).toContain('VP8');
    });

    it('is idempotent', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('with-exif.webp', 'image/webp');
      const once = await stripMetadata(file);
      const twice = await stripMetadata(new File([await once.arrayBuffer()], file.name, { type: file.type }));
      expect(twice.size).toBe(once.size);
    });
  });

  describe('all-metadata fixture', () => {
    it('strips all EXIF from all-metadata.jpg and produces a smaller JPEG', async () => {
      vi.restoreAllMocks();
      const { stripMetadata } = await importFresh();
      const file = fixtureFile('all-metadata.jpg', 'image/jpeg');
      const result = await stripMetadata(file);

      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBeLessThan(file.size);

      const out = new Uint8Array(await result.arrayBuffer());
      expect(out[0]).toBe(0xFF);
      expect(out[1]).toBe(0xD8);
    });
  });
});
