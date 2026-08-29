/**
 * Lossless EXIF stripper for AVIF images.
 *
 * AVIF (AV1 Image File Format) uses the same ISOBMFF container as HEIC.
 * Metadata items, the `meta` box, `iinf`/`iloc` structure, and the 'Exif'
 * item type are identical; only the image codec (AV1 vs. HEVC) and ftyp
 * brands differ.
 *
 * Specification: https://aomediacodec.github.io/av1-avif/
 *
 * Brand identification (AVIF spec §4)
 * ─────────────────────────────────────
 *   avif — single still image
 *   avis — image sequence / animated
 *
 * All major browsers support AVIF decoding, so canvas re-encode via
 * canvasStripper remains available as a fallback if this handler fails.
 */

import type { StripperHandler } from './types.ts';
import { stripExifItem } from '../format/isobmff.ts';
import { detectFormat } from '../format/detect.ts';

export const avifStripper: StripperHandler = {
  name: 'AVIF (lossless)',
  description: 'Removes the Exif metadata item from the ISOBMFF container without decoding the image.',
  lossless: true,
  experimental: true,

  claims: d => d.format === 'avif',

  strip: async (file: File): Promise<Blob> => {
    const data = new Uint8Array(await file.arrayBuffer());
    const { mime } = await detectFormat(file);
    return new Blob([stripExifItem(data).buffer as ArrayBuffer], { type: mime });
  },
};
