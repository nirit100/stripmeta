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

  supports: async (file) => file.type === 'image/jpeg' || file.type === 'image/jpg',

  strip: async (file) => {
    const dataUrl = await fileToDataUrl(file);
    return dataUrlToBlob(piexif.remove(dataUrl));
  },
};
