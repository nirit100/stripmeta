/**
 * Lossless EXIF stripper for HEIC / HEIF images.
 *
 * HEIC is a profile of HEIF (High Efficiency Image File Format), defined in
 * ISO/IEC 23008-12, using an ISOBMFF (ISO 14496-12) container.
 *
 * Brand identification (ISO/IEC 23008-12 §B.4.1)
 * ────────────────────────────────────────────────
 *   heic — single-image HEVC (most iPhone photos)
 *   heix — single-image HEVC (extended)
 *   hevc — HEVC image sequence
 *   hevx — HEVC image sequence (extended)
 *   mif1 — multi-image HEIF (generic)
 *   msf1 — multi-image HEIF sequence
 *
 * Safari on macOS/iOS decodes HEIC natively. Chrome and Firefox do not.
 * There is therefore no canvas fallback for HEIC on non-Apple platforms.
 */

import type { StripperHandler } from './types.ts';
import { stripExifItem } from '../format/isobmff.ts';

export const heicStripper: StripperHandler = {
  name: 'HEIC/HEIF (lossless)',
  description: 'Removes the Exif metadata item from the ISOBMFF container without decoding the image. Requires no re-encode; output is identical quality to the input.',
  lossless: true,
  experimental: true,

  // Identified purely by ftyp brand — a .heic the OS reported as
  // application/octet-stream is still a HEIC.
  claims: d => d.format === 'heic',

  strip: async (file: File): Promise<Blob> => {
    const data = new Uint8Array(await file.arrayBuffer());
    // macOS/iOS assigns image/heic to both .heic and .heif files, so browsers
    // may correct the download extension to .heic for a .heif input.
    // Use the original extension to preserve the correct MIME type.
    const ext = file.name.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'heif' ? 'image/heif' : (file.type || 'image/heic');
    return new Blob([stripExifItem(data).buffer as ArrayBuffer], { type: mimeType });
  },
};
