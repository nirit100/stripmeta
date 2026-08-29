/**
 * Container identification from magic bytes — the single owner of "what is this
 * file?" for the whole app.
 *
 * Content is the identity: a JPEG saved as .png is a JPEG, and a WebP the OS
 * typed as image/png is still a WebP. `file.type` is a guess the OS made from
 * the extension, so it is consulted only when the bytes say nothing at all.
 */

export type ImageFormat =
  | 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff'
  | 'heic' | 'avif'
  | 'unknown';

export interface DetectedFormat {
  format: ImageFormat;
  /**
   * The MIME type to treat this file as: the one its bytes imply, or the one
   * the browser reported when they implied nothing. Resolved here so consumers
   * never need to hold both the identity and the file to work it out — which
   * matters for SVG, text that can only ever be known by its reported type.
   */
  mime: string;
  /**
   * ftyp brands as found, major first. Informational only — the ambiguity they
   * encode is already resolved into `format`; kept for bug reports.
   */
  brands?: string[];
}

// Enough for an ftyp box with a good number of compatible brands.
const HEADER_BYTES = 64;

const CANONICAL_MIME: Record<Exclude<ImageFormat, 'unknown'>, string> = {
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
  bmp:  'image/bmp',
  tiff: 'image/tiff',
  heic: 'image/heic',
  avif: 'image/avif',
};

// Formats with no magic number to find. SVG is text, so an inconclusive sniff
// is expected rather than a gap in the table above.
const TEXT_BASED_MIME = new Set(['image/svg+xml']);

function ascii(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!);
}

function u32(d: Uint8Array, o: number): number {
  return ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
}

function readBrands(h: Uint8Array): string[] {
  // ftyp: [size][ 'ftyp' ][major:4][minor:4][compatible brands, 4 bytes each]
  const brands = [ascii(h, 8)];
  const end = Math.min(u32(h, 0), h.length);
  for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(h, o));
  return brands;
}

const AVIF_BRANDS = new Set(['avif', 'avis', 'MA1A', 'MA1B']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * Resolves an ISOBMFF file to a concrete format.
 *
 * AVIF is checked first and wins outright: both formats share the generic
 * 'mif1' brand, and AVIF files are routinely stamped with it as the major brand
 * while naming 'avif' only among their compatible brands. Deciding here — the
 * one place that knows both formats exist — keeps that ambiguity from leaking
 * into the handlers, where it could only be resolved by registration order.
 */
function isobmffFormat(brands: string[]): ImageFormat {
  if (brands.some(b => AVIF_BRANDS.has(b))) return 'avif';
  if (brands.some(b => HEIC_BRANDS.has(b))) return 'heic';
  return 'unknown';
}

function formatFromHeader(h: Uint8Array): { format: ImageFormat; brands?: string[] } {
  const at = (o: number, ...bytes: number[]) => bytes.every((b, i) => h[o + i] === b);

  if (h.length >= 3 && at(0, 0xFF, 0xD8, 0xFF)) return { format: 'jpeg' };
  if (h.length >= 8 && at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return { format: 'png' };
  if (h.length >= 12 && ascii(h, 0) === 'RIFF' && ascii(h, 8) === 'WEBP') return { format: 'webp' };

  if (h.length >= 12 && ascii(h, 4) === 'ftyp') {
    const brands = readBrands(h);
    return { format: isobmffFormat(brands), brands };
  }

  // "GIF87a" / "GIF89a"
  if (h.length >= 6 && ascii(h, 0) === 'GIF8' && h[5] === 0x61) return { format: 'gif' };
  if (h.length >= 2 && at(0, 0x42, 0x4D)) return { format: 'bmp' };
  if (h.length >= 4 && (at(0, 0x49, 0x49, 0x2A, 0x00) || at(0, 0x4D, 0x4D, 0x00, 0x2A))) return { format: 'tiff' };

  return { format: 'unknown' };
}

/**
 * Classifies a header that has already been read. `reportedType` is consulted
 * only when the bytes identify nothing.
 */
export function detectFormatFromHeader(h: Uint8Array, reportedType = ''): DetectedFormat {
  const { format, brands } = formatFromHeader(h);
  const mime = format === 'unknown'
    ? (reportedType || 'application/octet-stream')
    : CANONICAL_MIME[format];
  return brands ? { format, mime, brands } : { format, mime };
}

/** Reads the leading bytes of `file` and classifies it. */
export async function detectFormat(file: File): Promise<DetectedFormat> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  return detectFormatFromHeader(header, file.type);
}

/** True for the formats whose metadata lives in an ISOBMFF item. */
export function isIsobmff(format: ImageFormat): boolean {
  return format === 'heic' || format === 'avif';
}

/**
 * True when the bytes identified nothing but should have. Worth surfacing:
 * either the file isn't the image it claims to be, or this module is missing a
 * signature and we would like to hear about it.
 */
export function isUnexpectedlyUndetected(d: DetectedFormat): boolean {
  return d.format === 'unknown' && !TEXT_BASED_MIME.has(d.mime);
}
