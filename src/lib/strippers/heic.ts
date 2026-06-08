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

import type { StripperHandler, PlatformCapabilities } from './types.ts';
import { stripExifItem } from './isobmff.ts';

/** All ftyp major brands that identify a HEIC / HEIF still image. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Returns the ftyp major_brand string (bytes 8–11), or null if the file is not ISOBMFF. */
async function readBrand(file: File): Promise<string | null> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const boxType = String.fromCharCode(header[4]!, header[5]!, header[6]!, header[7]!);
  if (boxType !== 'ftyp') return null;
  return String.fromCharCode(header[8]!, header[9]!, header[10]!, header[11]!);
}

export const heicStripper: StripperHandler = {
  name: 'HEIC/HEIF (lossless)',
  description: 'Removes the Exif metadata item from the ISOBMFF container without decoding the image. Requires no re-encode; output is identical quality to the input.',
  lossless: true,
  experimental: true,

  supports: async (file: File, _caps: PlatformCapabilities): Promise<boolean> => {
    if (!file.type.includes('heic') && !file.type.includes('heif')) return false;
    const brand = await readBrand(file);
    return brand !== null && HEIC_BRANDS.has(brand);
  },

  strip: async (file: File): Promise<Blob> => {
    const data = new Uint8Array(await file.arrayBuffer());
    return new Blob([stripExifItem(data).buffer as ArrayBuffer], { type: file.type });
  },
};
