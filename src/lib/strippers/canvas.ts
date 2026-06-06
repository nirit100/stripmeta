import type { StripperHandler } from './types.ts';

function reEncode(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas encoding failed')),
        'image/jpeg',
        0.95,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not decode image: ${file.name}`));
    };

    img.src = objectUrl;
  });
}

// Fallback for any format the browser can decode but we have no lossless handler for
// (WebP, TIFF, AVIF, HEIC with Safari, GIF, BMP, etc.).
// The output is always JPEG at 0.95 quality, which drops all embedded metadata
// including ICC profiles, XMP, and any format-specific sidecar data.
export const canvasStripper: StripperHandler = {
  name: 'Canvas re-encode',
  description: 'Decodes the image to raw pixels and re-encodes as JPEG, stripping all embedded metadata. Introduces a small quality loss.',

  canHandle: (_file) => true,

  strip: reEncode,
};
