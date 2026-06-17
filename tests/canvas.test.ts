import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const fakeBlob = new Blob(['fake-jpeg-data'], { type: 'image/jpeg' });

// MockImage fires onload asynchronously (microtask) to simulate async image load.
class MockImage {
  naturalWidth = 100;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) { queueMicrotask(() => this.onload?.()); }
}

// MockImageError fires onerror instead, simulating a decode failure.
class MockImageError {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) { queueMicrotask(() => this.onerror?.()); }
}

function makeCanvasMock(blobResult: Blob | null) {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (cb: (b: Blob | null) => void) => cb(blobResult),
  };
}

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/strippers/canvas');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('canvasStripper', () => {
  it('is not lossless', async () => {
    const { canvasStripper } = await importFresh();
    expect(canvasStripper.lossless).toBe(false);
  });

  describe('supports()', () => {
    it('delegates to capabilities.canDecodeImage with the file MIME type', async () => {
      const { canvasStripper } = await importFresh();
      const caps = { canDecodeImage: vi.fn().mockResolvedValue(true) };
      const file = new File(['x'], 'photo.gif', { type: 'image/gif' });
      const result = await canvasStripper.supports(file, caps as any);
      expect(caps.canDecodeImage).toHaveBeenCalledWith('image/gif');
      expect(result).toBe(true);
    });

    it('returns false when the format is not decodable', async () => {
      const { canvasStripper } = await importFresh();
      const caps = { canDecodeImage: vi.fn().mockResolvedValue(false) };
      const file = new File(['x'], 'photo.heic', { type: 'image/heic' });
      expect(await canvasStripper.supports(file, caps as any)).toBe(false);
    });
  });

  describe('strip()', () => {
    const origCreateElement = document.createElement.bind(document);

    function setupMocks(
      opts: { blobResult?: Blob | null; failImage?: boolean } = {},
    ) {
      const { blobResult = fakeBlob, failImage = false } = opts;

      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

      vi.stubGlobal('Image', failImage ? MockImageError : MockImage);

      const canvas = makeCanvasMock(blobResult);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'canvas') return canvas as unknown as HTMLElement;
        return origCreateElement(tag);
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('resolves with a Blob when the image loads and canvas encodes successfully', async () => {
      setupMocks();
      const { canvasStripper } = await importFresh();
      const file = new File(['x'], 'photo.gif', { type: 'image/gif' });
      const result = await canvasStripper.strip(file);
      expect(result).toBeInstanceOf(Blob);
    });

    it('output type matches what canvas.toBlob produces', async () => {
      setupMocks({ blobResult: new Blob(['x'], { type: 'image/jpeg' }) });
      const { canvasStripper } = await importFresh();
      const result = await canvasStripper.strip(new File(['x'], 'a.gif', { type: 'image/gif' }));
      expect(result.type).toBe('image/jpeg');
    });

    it('rejects with "Canvas encoding failed" when toBlob returns null', async () => {
      setupMocks({ blobResult: null });
      const { canvasStripper } = await importFresh();
      await expect(canvasStripper.strip(new File(['x'], 'a.gif', { type: 'image/gif' })))
        .rejects.toThrow('Canvas encoding failed');
    });

    it('rejects with "Could not decode image: <filename>" when the image fails to load', async () => {
      setupMocks({ failImage: true });
      const { canvasStripper } = await importFresh();
      await expect(canvasStripper.strip(new File(['x'], 'broken.gif', { type: 'image/gif' })))
        .rejects.toThrow('Could not decode image: broken.gif');
    });

    it('revokes the object URL on successful encode', async () => {
      setupMocks();
      const { canvasStripper } = await importFresh();
      await canvasStripper.strip(new File(['x'], 'a.gif', { type: 'image/gif' }));
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('revokes the object URL even when the image fails to load', async () => {
      setupMocks({ failImage: true });
      const { canvasStripper } = await importFresh();
      await expect(
        canvasStripper.strip(new File(['x'], 'bad.gif', { type: 'image/gif' }))
      ).rejects.toThrow();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });
  });
});
