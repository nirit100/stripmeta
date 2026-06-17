// Image clipboard helpers, shared by the per-file copy button and the
// copy-result action button (previously duplicated verbatim in both).

/**
 * Re-encodes a non-PNG blob to PNG via canvas. PNG blobs pass through
 * unchanged. The result is a resolved Blob — Firefox rejects Promise values
 * inside ClipboardItem, so the blob must be ready before the write.
 */
async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
}

/** Writes an image blob to the system clipboard as PNG, re-encoding if needed. */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  const clipBlob = await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipBlob })]);
}

// Firefox for Android rejects clipboard.write() with image data, throwing
// NotAllowedError even for a ready PNG — image clipboard writes just aren't
// supported there. Surface that as a clear message instead of a generic failure.
export function copyFailLabel(err: unknown): string {
  return err instanceof DOMException && err.name === 'NotAllowedError'
    ? "Can't copy images here"
    : 'Failed';
}
