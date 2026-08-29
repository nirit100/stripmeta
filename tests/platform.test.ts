import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserCapabilities } from '../src/lib/platform/platform';

describe('BrowserCapabilities', () => {
  let caps: BrowserCapabilities;

  beforeEach(() => {
    caps = new BrowserCapabilities();
  });

  it('answers yes for every baseline type without probing', async () => {
    const baseline = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'image/webp', 'image/bmp', 'image/x-bmp', 'image/svg+xml', 'image/avif',
    ];
    for (const type of baseline) {
      expect(await caps.canDecodeImage(type), type).toBe(true);
    }
  });

  it('answers no for a type that is neither baseline nor probeable', async () => {
    // HEIC has no baseline entry and no probe sample, so it can only ever be
    // decided by the table — the branch that keeps non-Apple browsers honest.
    expect(await caps.canDecodeImage('image/heic')).toBe(false);
    expect(await caps.canDecodeImage('image/x-raw')).toBe(false);
  });

  it('probes TIFF rather than answering from the table', async () => {
    // TIFF is the one type that reaches createImageBitmap. happy-dom has no
    // decoder, so the probe rejects and the answer is no — what matters is that
    // it was decided by probing, not by absence from the baseline list.
    const probe = vi.fn().mockRejectedValue(new Error('no decoder'));
    vi.stubGlobal('createImageBitmap', probe);

    expect(await caps.canDecodeImage('image/tiff')).toBe(false);
    expect(probe).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('accepts TIFF when the browser can decode the probe sample', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({}));
    expect(await caps.canDecodeImage('image/tiff')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('caches the answer, so a type is probed at most once', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('no decoder'));
    vi.stubGlobal('createImageBitmap', probe);

    await caps.canDecodeImage('image/tiff');
    await caps.canDecodeImage('image/tiff');

    expect(probe).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
