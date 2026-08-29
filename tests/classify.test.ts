import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi } from 'vitest';


async function importFresh() {
  vi.resetModules();
  return import('../src/lib/strippers/registry');
}

// Content-free: the byte-sniffing handlers reject these, so they exercise the
// canvas fallback, which is the only handler that still asks about MIME type.
function makeTypedFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

function makeJpegFile(name = 'a.jpg'): File {
  return new File([JPEG_SIG], name, { type: 'image/jpeg' });
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

// classify() derives its level from whichever handler claims the file, so these
// cover the mapping (lossless → none, experimental flag → experimental, not
// lossless → lossy, nothing → unsupported). Which handler claims what is the
// resolve() block's job, below.
describe('StripperManager.classify — defaultStripperManager', () => {
  it('returns none for the lossless handlers', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeJpegFile())).toBe('none');
    expect(await defaultStripperManager.classify(makePngFile())).toBe('none');
    expect(await defaultStripperManager.classify(makeWebpFile())).toBe('none');
  });

  it('returns experimental for a handler that declares itself so', async () => {
    // A real HEIC: lossless, but flagged experimental, which must win over 'none'.
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(fixtureFile('heic_sample_file_50KB.heic', 'image/heic')))
      .toBe('experimental');
  });

  it('falls back to lossy for formats the browser can decode but we cannot strip losslessly', async () => {
    const { defaultStripperManager } = await importFresh();
    // A real GIF: no lossless handler claims it, so canvas does.
    expect(await defaultStripperManager.classify(fixtureFile('test.gif', 'image/gif'))).toBe('lossy');
    // SVG is the case that can only be recognised by its reported type.
    expect(await defaultStripperManager.classify(makeTypedFile('a.svg', 'image/svg+xml'))).toBe('lossy');
  });

  it('is unsupported when nothing claims the file and the browser cannot decode it', async () => {
    const { defaultStripperManager } = await importFresh();
    expect(await defaultStripperManager.classify(makeTypedFile('a.heic', 'image/heic'))).toBe('unsupported');
    expect(await defaultStripperManager.classify(makeTypedFile('a.raw', 'image/x-raw'))).toBe('unsupported');
  });
});

describe('StripperManager.classify — paranoidStripperManager', () => {
  it('is lossy for everything the browser can decode, losslessly strippable or not', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(makeJpegFile())).toBe('lossy');
    expect(await paranoidStripperManager.classify(makePngFile())).toBe('lossy');
  });

  it('is still unsupported for what the browser cannot decode', async () => {
    // Paranoid mode holds only the canvas handler, so a HEIC that the default
    // manager would strip losslessly becomes unstrippable here.
    const { paranoidStripperManager } = await importFresh();
    expect(await paranoidStripperManager.classify(fixtureFile('heic_sample_file_50KB.heic', 'image/heic')))
      .toBe('unsupported');
  });
});

describe('StripperManager.resolve', () => {
  it('resolves JPEG to the JPEG handler', async () => {
    const { defaultStripperManager } = await importFresh();
    const h = await defaultStripperManager.resolve(makeJpegFile());
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

  it('throws when no handler claims the file, rather than returning a wrong one', async () => {
    const { defaultStripperManager } = await importFresh();
    await expect(
      defaultStripperManager.resolve(makeTypedFile('a.raw', 'image/x-raw'))
    ).rejects.toThrow();
  });

  it('resolves a losslessly-strippable file to canvas in paranoid mode', async () => {
    const { paranoidStripperManager } = await importFresh();
    expect((await paranoidStripperManager.resolve(makeJpegFile())).name).toBe('Canvas re-encode');
  });
});

describe('StripperManager — content beats the reported type', () => {
  // Android sometimes saves JPEG screenshots with a .png extension.
  it('routes JPEG content to the JPEG handler despite a PNG name and type', async () => {
    const { defaultStripperManager } = await importFresh();
    const jpegAsPng = new File([JPEG_SIG], 'screenshot.png', { type: 'image/png' });
    expect((await defaultStripperManager.resolve(jpegAsPng)).name).toBe('JPEG (lossless)');
    expect(await defaultStripperManager.classify(jpegAsPng)).toBe('none');
  });

  it('routes WebP content to the WebP handler despite a generic type', async () => {
    const { defaultStripperManager } = await importFresh();
    const webpOddMime = new File([WEBP_SIG], 'image.bin', { type: 'application/octet-stream' });
    expect((await defaultStripperManager.resolve(webpOddMime)).name).toBe('WebP (lossless)');
  });

  it('does not hand a lossless handler a file whose bytes say otherwise', async () => {
    // Bytes match nothing. Every lossless handler declines on content, so this
    // reaches canvas — a MIME-trusting handler would have accepted and thrown.
    const { defaultStripperManager } = await importFresh();
    const garbage = new Uint8Array([0, 0, 0, 0]);
    expect(await defaultStripperManager.classify(new File([garbage], 'a.png', { type: 'image/png' }))).toBe('lossy');
    expect(await defaultStripperManager.classify(new File([garbage], 'a.webp', { type: 'image/webp' }))).toBe('lossy');
  });
});
