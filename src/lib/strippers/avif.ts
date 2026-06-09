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

import type { StripperHandler, PlatformCapabilities } from './types.ts';
import { stripExifItem } from './isobmff.ts';

const AVIF_BRANDS = new Set(['avif', 'avis', 'MA1A', 'MA1B']);

async function readBrand(file: File): Promise<string | null> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const boxType = String.fromCharCode(header[4]!, header[5]!, header[6]!, header[7]!);
  if (boxType !== 'ftyp') return null;
  return String.fromCharCode(header[8]!, header[9]!, header[10]!, header[11]!);
}

export const avifStripper: StripperHandler = {
  name: 'AVIF (lossless)',
  description: 'Removes the Exif metadata item from the ISOBMFF container without decoding the image.',
  lossless: true,
  experimental: true,

  supports: async (file: File, _caps: PlatformCapabilities): Promise<boolean> => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const mimeOk = file.type === 'image/avif';
    const extOk  = ext === 'avif';
    if (!mimeOk && !extOk) return false;
    const brand = await readBrand(file);
    return brand !== null && AVIF_BRANDS.has(brand);
  },

  strip: async (file: File): Promise<Blob> => {
    const data = new Uint8Array(await file.arrayBuffer());
    return new Blob([stripExifItem(data).buffer as ArrayBuffer], { type: file.type });
  },
};
