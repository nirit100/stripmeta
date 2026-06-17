import type { PlatformCapabilities } from '../strippers/types.ts';

// Formats all modern browsers can canvas-decode without probing.
const BASELINE = new Set([
  'image/jpeg', 'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp', 'image/x-bmp',
  'image/svg+xml',
  'image/avif', // Chrome 85+, Firefox 93+, Safari 16+
]);

// Minimal valid samples for formats that need a live probe.
// A zero-byte blob gives an immediate decode error even on supported browsers,
// so we carry just enough bytes for the browser to identify the format.
const TIFF_PROBE = new Uint8Array([
  0x49, 0x49, 0x2A, 0x00, // "II" + magic 42 (little-endian TIFF)
  0x08, 0x00, 0x00, 0x00, // IFD offset = 8
  0x00, 0x00,              // 0 entries
  0x00, 0x00, 0x00, 0x00, // next IFD = none
]);

const PROBE_SAMPLES = new Map<string, Uint8Array>([
  ['image/tiff',   TIFF_PROBE],
  ['image/x-tiff', TIFF_PROBE],
]);

export class BrowserCapabilities implements PlatformCapabilities {
  private readonly cache = new Map<string, boolean>();

  async canDecodeImage(mimeType: string): Promise<boolean> {
    if (this.cache.has(mimeType)) return this.cache.get(mimeType)!;
    const result = await this.check(mimeType);
    this.cache.set(mimeType, result);
    return result;
  }

  private async check(mimeType: string): Promise<boolean> {
    if (BASELINE.has(mimeType)) return true;
    const sample = PROBE_SAMPLES.get(mimeType);
    if (!sample) return false;
    return createImageBitmap(new Blob([new Uint8Array(sample)], { type: mimeType }))
      .then(() => true)
      .catch(() => false);
  }
}

export const browserCapabilities = new BrowserCapabilities();
