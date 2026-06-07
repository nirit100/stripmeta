import piexif from 'piexifjs';
import type { StripperHandler } from './types.ts';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)![1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const jpegStripper: StripperHandler = {
  name: 'JPEG (lossless)',
  description: 'Removes EXIF segments from the JPEG binary without touching the compressed image data.',
  lossless: true,

  supports: async (file) => {
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') return true;
    // Accept actual JPEG data regardless of reported MIME type (e.g. Android screenshots
    // sometimes have a .png extension but JPEG content).
    const sig = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    return sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF;
  },

  strip: async (file) => {
    let dataUrl = await fileToDataUrl(file);
    // piexifjs rejects any data URL whose MIME type is not image/jpeg, even if the
    // content is valid JPEG (e.g. a .png file that actually contains JPEG data).
    if (!dataUrl.startsWith('data:image/jpeg;')) {
      dataUrl = 'data:image/jpeg;base64,' + dataUrl.split(',')[1];
    }
    return dataUrlToBlob(piexif.remove(dataUrl));
  },
};
