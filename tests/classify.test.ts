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

function makeTypedFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

describe('StripperManager.classify — defaultStripperManager', () => {
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
    expect(await defaultStripperManager.classify(fixtureFile('test.gif', 'image/gif'))).toBe('lossy');
  });
});

describe('StripperManager.classify — paranoidStripperManager', () => {
  it('returns lossy for JPEG (canvas re-encode always)', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(makeTypedFile('a.jpg', 'image/jpeg'))).toBe('lossy');
  });

  it('returns lossy for PNG', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(makeTypedFile('a.png', 'image/png'))).toBe('lossy');
  });

  it('returns lossy for GIF', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(makeTypedFile('a.gif', 'image/gif'))).toBe('lossy');
  });

  it('returns unsupported for HEIC (canvas cannot decode it)', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(makeTypedFile('a.heic', 'image/heic'))).toBe('unsupported');
  });
});

describe('StripperManager.resolve', () => {
  it('resolves JPEG to the JPEG handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeTypedFile('a.jpg', 'image/jpeg'));
    expect(h.name).toBe('JPEG (lossless)');
    expect(h.lossless).toBe(true);
  });

  it('resolves PNG to the PNG handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeTypedFile('a.png', 'image/png'));
    expect(h.name).toBe('PNG (lossless)');
    expect(h.lossless).toBe(true);
  });

  it('resolves WebP to the WebP handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeTypedFile('a.webp', 'image/webp'));
    expect(h.name).toBe('WebP (lossless)');
    expect(h.lossless).toBe(true);
  });

  it('resolves GIF to the canvas handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeTypedFile('a.gif', 'image/gif'));
    expect(h.name).toBe('Canvas re-encode');
    expect(h.lossless).toBe(false);
  });

  it('throws for HEIC (no available handler)', async () => {
    const { defaultStripperManager } = await importFresh();
    await expect(
      defaultStripperManager.resolve(makeTypedFile('a.heic', 'image/heic'))
    ).rejects.toThrow();
  });

  it('resolves every type to canvas in paranoid mode', async () => {
    const { paranoidStripperManager } = await importFresh();
    const jpeg = await paranoidStripperManager.resolve(makeTypedFile('a.jpg', 'image/jpeg'));
    const png = await paranoidStripperManager.resolve(makeTypedFile('a.png', 'image/png'));
    expect(jpeg.name).toBe('Canvas re-encode');
    expect(png.name).toBe('Canvas re-encode');
  });
});
