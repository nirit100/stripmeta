import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserCapabilities } from '../src/lib/platform/platform';

describe('BrowserCapabilities', () => {
  let caps: BrowserCapabilities;

  beforeEach(() => {
    caps = new BrowserCapabilities();
  });

  describe('BASELINE types — always supported without probing', () => {
    const baseline = [
      'image/jpeg', 'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp', 'image/x-bmp',
      'image/svg+xml',
      'image/avif',
    ];

    for (const type of baseline) {
      it(`returns true for ${type}`, async () => {
        expect(await caps.canDecodeImage(type)).toBe(true);
      });
    }
  });

  describe('unsupported types', () => {
    it('returns false for HEIC (not in BASELINE or PROBE_SAMPLES)', async () => {
      expect(await caps.canDecodeImage('image/heic')).toBe(false);
    });

    it('returns false for HEIF', async () => {
      expect(await caps.canDecodeImage('image/heif')).toBe(false);
    });

    it('returns false for completely unknown types', async () => {
      expect(await caps.canDecodeImage('image/x-raw')).toBe(false);
    });

    it('returns false for TIFF in test environment (createImageBitmap unavailable or rejects)', async () => {
      expect(await caps.canDecodeImage('image/tiff')).toBe(false);
    });
  });

  it('caches results — subsequent calls return the same value', async () => {
    const first = await caps.canDecodeImage('image/jpeg');
    const second = await caps.canDecodeImage('image/jpeg');
    expect(first).toBe(true);
    expect(second).toBe(true);

    const firstNo = await caps.canDecodeImage('image/heic');
    const secondNo = await caps.canDecodeImage('image/heic');
    expect(firstNo).toBe(false);
    expect(secondNo).toBe(false);
  });
});
