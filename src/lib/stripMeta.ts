import exifr from 'exifr';
import extract from 'png-chunks-extract';
import { StripperManager } from './strippers/manager.ts';
import { jpegStripper } from './strippers/jpeg.ts';
import { pngStripper } from './strippers/png.ts';
import { webpStripper } from './strippers/webp.ts';
import { canvasStripper } from './strippers/canvas.ts';
import { browserCapabilities } from './platform.ts';

export type { StripperHandler, WarningLevel } from './strippers/types.ts';
export { StripperManager };

// Handlers are tried in registration order; first match wins.
// canvasStripper must be last — it defers to capabilities to decide support.
export const defaultStripperManager = new StripperManager(browserCapabilities)
  .register(jpegStripper)
  .register(pngStripper)
  .register(webpStripper)
  .register(canvasStripper);

// Paranoid mode: skip all native handlers and always re-encode through canvas.
// Output is always JPEG at 0.95 quality, stripping every form of embedded metadata.
export const paranoidStripperManager = new StripperManager(browserCapabilities)
  .register(canvasStripper);

// — PNG text chunk parsing —

export interface MetadataSection {
  name: string;
  entries: { key: string; value: string }[];
}

function decodePngTextChunks(data: Uint8Array): MetadataSection | null {
  const chunks = extract(data);
  const entries: { key: string; value: string }[] = [];

  for (const chunk of chunks) {
    if (chunk.name === 'tEXt') {
      const sep = (chunk.data as Uint8Array).indexOf(0);
      if (sep === -1) continue;
      const key = new TextDecoder('latin1').decode(chunk.data.subarray(0, sep));
      const value = new TextDecoder('latin1').decode(chunk.data.subarray(sep + 1)).trim();
      if (value) entries.push({ key, value });
    } else if (chunk.name === 'iTXt') {
      const sep = (chunk.data as Uint8Array).indexOf(0);
      if (sep === -1) continue;
      const key = new TextDecoder('latin1').decode(chunk.data.subarray(0, sep));
      if (chunk.data[sep + 1] !== 0) continue; // skip compressed iTXt
      let pos = sep + 3; // past null + compression flag + compression method
      while (pos < chunk.data.length && chunk.data[pos] !== 0) pos++;
      pos++; // past language tag null
      while (pos < chunk.data.length && chunk.data[pos] !== 0) pos++;
      pos++; // past translated keyword null
      const value = new TextDecoder('utf-8').decode(chunk.data.subarray(pos)).trim();
      if (value) entries.push({ key, value });
    }
  }

  return entries.length ? { name: 'Text', entries } : null;
}

// — Value formatting —

function formatExifrValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return null; // skip binary blobs
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
  if (Array.isArray(v)) {
    const parts = v.map(x => formatExifrValue(x)).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') return null; // skip nested objects (e.g. MakerNote sub-IFDs)
  const s = String(v);
  return s.trim() || null;
}

// — Public API —

export interface MetadataPreview {
  gps: { latitude: number; longitude: number } | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  software: string | null;
  dateTime: Date | string | null;
  artist: string | null;
  userComment: string | null;
}

export async function readMetadata(file: File): Promise<MetadataPreview> {
  const [exifRaw, gpsResult, pngText] = await Promise.all([
    exifr.parse(file, {
      pick: ['Make', 'Model', 'SerialNumber', 'Software', 'DateTimeOriginal', 'DateTime', 'Artist', 'UserComment'],
    }).catch(() => null),
    exifr.gps(file).catch(() => null),
    file.type === 'image/png'
      ? file.arrayBuffer().then(b => decodePngTextChunks(new Uint8Array(b))).catch(() => null)
      : Promise.resolve(null),
  ]);

  const gps = (gpsResult?.latitude != null && gpsResult?.longitude != null)
    ? { latitude: gpsResult.latitude, longitude: gpsResult.longitude }
    : null;

  // For PNG: pull common text-chunk keys that map to our preview fields
  const textMap = Object.fromEntries(pngText?.entries.map(e => [e.key, e.value]) ?? []);

  // exifr normalizes UserComment to camelCase; EXIF stores it with an 8-byte charset header
  const rawComment = exifRaw?.userComment ?? exifRaw?.UserComment;
  const userComment = typeof rawComment === 'string'
    ? (/^(ASCII|UNICODE|JIS)/.test(rawComment) ? rawComment.slice(8) : rawComment)
        .replace(/\0/g, '').trim() || null
    : null;

  return {
    gps,
    make: exifRaw?.Make ?? null,
    model: exifRaw?.Model ?? null,
    serialNumber: exifRaw?.SerialNumber ?? null,
    software: exifRaw?.Software ?? textMap['Software'] ?? textMap['Comment'] ?? null,
    dateTime: exifRaw?.DateTimeOriginal ?? exifRaw?.DateTime ?? textMap['Creation Time'] ?? null,
    artist: exifRaw?.Artist ?? null,
    userComment,
  };
}

export async function readRichMetadata(file: File): Promise<{ sections: MetadataSection[]; parseError?: unknown; hasUnreadableData?: true }> {
  const sections: MetadataSection[] = [];
  let parseError: unknown;
  let hasUnreadableData: true | undefined;

  const raw = await exifr.parse(file, true)
    .catch((err: unknown) => { parseError = err; return null; }) as Record<string, unknown> | null;
  if (raw) {
    // exifr surfaces parsing failures as a returned `errors` array rather than throwing.
    if (Array.isArray(raw.errors) && (raw.errors as unknown[]).length > 0) {
      parseError = (raw.errors as Error[])[0];
    }
    const allKeys = Object.keys(raw).filter(k => k !== 'errors');
    const entries = allKeys
      .map(key => ({ key, value: formatExifrValue(raw[key]) }))
      .filter((e): e is { key: string; value: string } => e.value !== null);
    if (entries.length < allKeys.length) hasUnreadableData = true;
    if (entries.length) sections.push({ name: 'EXIF / XMP / IPTC', entries });
  }

  if (file.type === 'image/png') {
    const buf = await file.arrayBuffer().catch(() => null);
    if (buf) {
      try {
        const section = decodePngTextChunks(new Uint8Array(buf));
        if (section) sections.push(section);
      } catch {
        // ignore malformed or unsupported PNG chunk structures
      }
    }
  }

  return { sections, parseError, hasUnreadableData };
}

export function stripMetadata(file: File): Promise<Blob> {
  return defaultStripperManager.strip(file);
}
