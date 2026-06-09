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

// Helpers that include the correct magic bytes so format-specific handlers accept them.
const PNG_SIG  = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const WEBP_SIG = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const JPEG_SIG = new Uint8Array([0xFF, 0xD8, 0xFF]);

function makePngFile(name = 'a.png'): File  { return new File([PNG_SIG],  name, { type: 'image/png' }); }
function makeWebpFile(name = 'a.webp'): File { return new File([WEBP_SIG], name, { type: 'image/webp' }); }

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
    expect(await defaultStripperManager.classify(makePngFile())).toBe('none');
  });

  it('returns none for WebP', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeWebpFile())).toBe('none');
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
    const h = await defaultStripperManager.resolve(makePngFile());
    expect(h.name).toBe('PNG (lossless)');
    expect(h.lossless).toBe(true);
  });

  it('resolves WebP to the WebP handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeWebpFile());
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

describe('StripperManager — magic byte detection', () => {
  // JPEG-as-PNG: Android sometimes saves JPEG screenshots with a .png extension.
  it('JPEG content with PNG MIME resolves to JPEG handler (lossless)', async () => {
    const { defaultStripperManager } = await importFresh();
    const jpegAsPng = new File([JPEG_SIG], 'screenshot.png', { type: 'image/png' });
    const h = await defaultStripperManager.resolve(jpegAsPng);
    expect(h.name).toBe('JPEG (lossless)');
  });

  it('JPEG content with PNG MIME classifies as none (JPEG handler wins via magic bytes)', async () => {
    const { defaultStripperManager } = await importFresh();
    const jpegAsPng = new File([JPEG_SIG], 'screenshot.png', { type: 'image/png' });
    expect(await defaultStripperManager.classify(jpegAsPng)).toBe('none');
  });

  // Content with no recognised magic bytes and WebP MIME: webpStripper rejects (bytes mismatch),
  // jpegStripper rejects (no JPEG bytes), pngStripper rejects (wrong MIME), canvas handles it.
  it('garbage content with WebP MIME falls through to canvas (lossy)', async () => {
    const { defaultStripperManager } = await importFresh();
    const garbage = new File([new Uint8Array([0, 0, 0, 0])], 'a.webp', { type: 'image/webp' });
    expect(await defaultStripperManager.classify(garbage)).toBe('lossy');
  });

  // Real WebP content with a generic MIME type: webpStripper matches on magic bytes.
  it('WebP content with non-standard MIME resolves to WebP handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const webpOddMime = new File([WEBP_SIG], 'image.bin', { type: 'application/octet-stream' });
    const h = await defaultStripperManager.resolve(webpOddMime);
    expect(h.name).toBe('WebP (lossless)');
  });

  // Real PNG content with PNG MIME: PNG stripper verifies magic bytes and accepts.
  it('non-PNG content with PNG MIME is rejected by the PNG handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const fakeContent = new File([new Uint8Array([0, 0, 0, 0])], 'a.png', { type: 'image/png' });
    // PNG stripper rejects -> JPEG stripper rejects (no JPEG magic) -> canvas handles it
    expect(await defaultStripperManager.classify(fakeContent)).toBe('lossy');
  });
});
