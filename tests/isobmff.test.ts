import { describe, it, expect } from 'vitest';
import { stripExifItem, readExifBytes, iterBoxes } from '../src/lib/strippers/isobmff';
import { heicStripper } from '../src/lib/strippers/heic';
import { avifStripper } from '../src/lib/strippers/avif';
import { buildIsobmffFile } from './fixtures/isobmff';

const mockCaps = { canDecodeImage: async () => false };

// ── Inspection helpers ────────────────────────────────────────────────────────

function r32(d: Uint8Array, o: number): number {
  return ((d[o]! << 24) | (d[o+1]! << 16) | (d[o+2]! << 8) | d[o+3]!) >>> 0;
}
function r16(d: Uint8Array, o: number): number { return (d[o]! << 8 | d[o+1]!) >>> 0; }

function findBoxIn(data: Uint8Array, type: string): { offset: number; size: number } | null {
  for (const b of iterBoxes(data, 0, data.length)) if (b.type === type) return b;
  return null;
}

function findBoxInside(data: Uint8Array, parentType: string, childType: string): { offset: number; size: number } | null {
  const p = findBoxIn(data, parentType);
  if (!p) return null;
  // FullBox: skip 8-byte box header + 4-byte version/flags
  const start = p.offset + 8 + 4;
  for (const b of iterBoxes(data, start, p.offset + p.size)) if (b.type === childType) return b;
  return null;
}

function getIinfEntryCount(data: Uint8Array): number {
  const iinf = findBoxInside(data, 'meta', 'iinf');
  if (!iinf) return 0;
  // iinf FullBox: header(8) + version/flags(4) -> entry_count at +12
  return r16(data, iinf.offset + 12);
}

function getIlocItemCount(data: Uint8Array): number {
  const iloc = findBoxInside(data, 'meta', 'iloc');
  if (!iloc) return 0;
  // iloc FullBox: header(8) + version/flags(4) + nibbles(2) -> item_count at +14
  return r16(data, iloc.offset + 14);
}

function hasItemType(data: Uint8Array, fourCC: string): boolean {
  const iinf = findBoxInside(data, 'meta', 'iinf');
  if (!iinf) return false;
  // iinf body starts after header(8) + version/flags(4) + entry_count(2)
  const start = iinf.offset + 14;
  for (const infe of iterBoxes(data, start, iinf.offset + iinf.size)) {
    if (infe.type !== 'infe') continue;
    // infe v2: header(8) + version/flags(4) + itemId(2) + protection(2) = 16, then 4cc
    const t = String.fromCharCode(data[infe.offset + 16]!, data[infe.offset + 17]!, data[infe.offset + 18]!, data[infe.offset + 19]!);
    if (t === fourCC) return true;
  }
  return false;
}

/** Returns the file-absolute offset for the first iloc entry (image item). */
function getImageOffset(data: Uint8Array): number {
  const iloc = findBoxInside(data, 'meta', 'iloc');
  if (!iloc) return -1;
  // iloc v0 first entry: header(8)+fullbox(4)+nibbles(2)+count(2) = 16, then item_id(2)+dri(2)+ext_count(2)+offset(4)
  return r32(data, iloc.offset + 16 + 2 + 2 + 2);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stripExifItem', () => {

  describe('no-op cases', () => {
    it('returns input unchanged when there is no meta box', () => {
      const input = new Uint8Array([1, 2, 3, 4]);
      expect(stripExifItem(input)).toBe(input);
    });

    it('returns input unchanged when there is no Exif item in iinf', () => {
      const file = buildIsobmffFile({ exifData: null });
      expect(stripExifItem(file)).toBe(file);
    });

    it('is idempotent: stripping an already-stripped file returns it unchanged', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(4) });
      const once = stripExifItem(file);
      expect(stripExifItem(once)).toBe(once);
    });
  });

  describe('Exif removal', () => {
    it('removes the Exif infe entry from iinf', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(8) });
      expect(hasItemType(file, 'Exif')).toBe(true);
      expect(hasItemType(stripExifItem(file), 'Exif')).toBe(false);
    });

    it('decrements the iinf entry_count', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(8) });
      expect(getIinfEntryCount(file)).toBe(2);
      expect(getIinfEntryCount(stripExifItem(file))).toBe(1);
    });

    it('removes the Exif entry from iloc', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(8) });
      expect(getIlocItemCount(file)).toBe(2);
      expect(getIlocItemCount(stripExifItem(file))).toBe(1);
    });

    it('preserves the image infe entry', () => {
      const file = buildIsobmffFile({ imageItemType: 'hvc1', exifData: new Uint8Array(8) });
      expect(hasItemType(stripExifItem(file), 'hvc1')).toBe(true);
    });

    it('produces a smaller file', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(256).fill(0xff) });
      expect(stripExifItem(file).length).toBeLessThan(file.length);
    });
  });

  describe('data integrity', () => {
    it('preserves image data bytes exactly', () => {
      const img  = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
      const exif = new Uint8Array([0xe0, 0xe1, 0xe2, 0xe3]);
      const file = buildIsobmffFile({ imageData: img, exifData: exif });
      const out  = stripExifItem(file);

      const imgOff = getImageOffset(out);
      expect(Array.from(out.subarray(imgOff, imgOff + img.length))).toEqual(Array.from(img));
    });

    it('zeros out the former Exif data bytes', () => {
      const img  = new Uint8Array(4).fill(0xaa);
      const exif = new Uint8Array([0xe0, 0xe1, 0xe2, 0xe3]);
      const file = buildIsobmffFile({ imageData: img, exifData: exif });

      // Exif data follows image data inside mdat
      const mdat = findBoxIn(file, 'mdat')!;
      const exifOffInOriginal = mdat.offset + 8 + img.length;

      const out = stripExifItem(file);
      const metaDelta = file.length - out.length;
      const exifOffInOutput = exifOffInOriginal - metaDelta;
      expect(Array.from(out.subarray(exifOffInOutput, exifOffInOutput + exif.length))).toEqual([0, 0, 0, 0]);
    });

    it('adjusts iloc offset for the image item by the exact metaDelta', () => {
      const file   = buildIsobmffFile({ exifData: new Uint8Array(32) });
      const before = getImageOffset(file);
      const out    = stripExifItem(file);
      const after  = getImageOffset(out);

      expect(after).toBeLessThan(before);
      expect(before - after).toBe(file.length - out.length);
    });

    it('works for AVIF (av01 item, avif brand)', () => {
      const file = buildIsobmffFile({ brand: 'avif', imageItemType: 'av01', exifData: new Uint8Array(8) });
      const out  = stripExifItem(file);
      expect(hasItemType(out, 'Exif')).toBe(false);
      expect(hasItemType(out, 'av01')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles larger Exif blobs correctly', () => {
      const file = buildIsobmffFile({ exifData: new Uint8Array(4096).fill(0xff) });
      const out  = stripExifItem(file);
      expect(hasItemType(out, 'Exif')).toBe(false);
      expect(getIinfEntryCount(out)).toBe(1);
    });

    it('returns input unchanged for a file too short to contain any boxes', () => {
      const bad = new Uint8Array([0, 0, 0, 8]);
      expect(stripExifItem(bad)).toBe(bad);
    });
  });
});

// ── iref cleanup ──────────────────────────────────────────────────────────────

/** Finds an iref sub-box of the given reference type; returns its content offset or -1. */
function findIrefSubBox(data: Uint8Array, refType: string): number {
  const meta = findBoxIn(data, 'meta');
  if (!meta) return -1;
  const iref = findBoxInside(data, 'meta', 'iref');
  if (!iref) return -1;
  // iref FullBox: header(8) + version/flags(4) = 12 bytes before sub-boxes
  const subStart = iref.offset + 12;
  for (const sub of iterBoxes(data, subStart, iref.offset + iref.size)) {
    if (sub.type === refType) return sub.offset;
  }
  return -1;
}

describe('iref cleanup', () => {
  it('removes cdsc reference box when the Exif item is stripped', () => {
    const file = buildIsobmffFile({ exifData: new Uint8Array(8) });
    expect(findIrefSubBox(file, 'cdsc')).toBeGreaterThan(-1);
    const out = stripExifItem(file);
    expect(findIrefSubBox(out, 'cdsc')).toBe(-1);
  });

  it('preserves non-Exif iref entries (e.g. thmb)', () => {
    const file = buildIsobmffFile({
      exifData: new Uint8Array(8),
      irefEntries: [
        { type: 'cdsc', fromId: 2, toIds: [1] },
        { type: 'thmb', fromId: 1, toIds: [3] },
      ],
    });
    const out = stripExifItem(file);
    expect(findIrefSubBox(out, 'cdsc')).toBe(-1);
    expect(findIrefSubBox(out, 'thmb')).toBeGreaterThan(-1);
  });

  it('file without iref box is processed normally', () => {
    const file = buildIsobmffFile({ exifData: new Uint8Array(8), irefEntries: [] });
    const out  = stripExifItem(file);
    expect(hasItemType(out, 'Exif')).toBe(false);
  });

  it('meta size is correct after iref cleanup', () => {
    const file = buildIsobmffFile({ exifData: new Uint8Array(8) });
    const out  = stripExifItem(file);
    // The reported meta box size must equal the actual space occupied by meta
    const meta = findBoxIn(out, 'meta')!;
    const afterMeta = meta.offset + meta.size;
    // Everything after meta should start with the mdat box header
    expect(r32(out, afterMeta)).toBeGreaterThan(0); // mdat has a valid size
    expect(String.fromCharCode(out[afterMeta + 4]!, out[afterMeta + 5]!, out[afterMeta + 6]!, out[afterMeta + 7]!)).toBe('mdat');
  });
});

// ── XMP stripping ─────────────────────────────────────────────────────────────

describe('XMP stripping', () => {
  it('removes a mime item with content_type application/rdf+xml', () => {
    const file = buildIsobmffFile({ xmpData: new Uint8Array(16).fill(0x3c) });
    expect(hasItemType(file, 'mime')).toBe(true);
    const out = stripExifItem(file);
    expect(hasItemType(out, 'mime')).toBe(false);
  });

  it('strips both Exif and XMP in one pass', () => {
    const file = buildIsobmffFile({
      exifData: new Uint8Array(8).fill(0xee),
      xmpData:  new Uint8Array(8).fill(0x3c),
    });
    expect(getIinfEntryCount(file)).toBe(3); // image + exif + xmp
    const out = stripExifItem(file);
    expect(getIinfEntryCount(out)).toBe(1);
    expect(hasItemType(out, 'Exif')).toBe(false);
    expect(hasItemType(out, 'mime')).toBe(false);
    expect(hasItemType(out, 'hvc1')).toBe(true);
  });

  it('is idempotent after XMP removal', () => {
    const file = buildIsobmffFile({ xmpData: new Uint8Array(8) });
    const once = stripExifItem(file);
    expect(stripExifItem(once)).toBe(once);
  });

  it('zeros former XMP payload bytes', () => {
    const xmpPayload = new Uint8Array(8).fill(0x3c);
    const file = buildIsobmffFile({ xmpData: xmpPayload });
    const out  = stripExifItem(file);
    // XMP was the first (and only) item after image data in mdat
    const mdat = findBoxIn(out, 'mdat')!;
    const imgLen = 4; // default imageData length
    const xmpOff = mdat.offset + 8 + imgLen;
    expect(Array.from(out.subarray(xmpOff, xmpOff + 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

// ── mdat-before-meta offset adjustment ───────────────────────────────────────

describe('mdat-before-meta layout', () => {
  it('image iloc offset is unchanged after stripping (data is before meta)', () => {
    const img  = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const file = buildIsobmffFile({ imageData: img, exifData: new Uint8Array(8), mdatFirst: true });
    const before = getImageOffset(file);
    const out    = stripExifItem(file);
    const after  = getImageOffset(out);
    // Image data is in mdat which precedes meta — offset must not change
    expect(after).toBe(before);
  });

  it('image data bytes are preserved correctly', () => {
    const img  = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const file = buildIsobmffFile({ imageData: img, exifData: new Uint8Array(8), mdatFirst: true });
    const out  = stripExifItem(file);
    const off  = getImageOffset(out);
    expect(Array.from(out.subarray(off, off + img.length))).toEqual(Array.from(img));
  });

  it('Exif item is removed from iinf and iloc', () => {
    const file = buildIsobmffFile({ exifData: new Uint8Array(8), mdatFirst: true });
    const out  = stripExifItem(file);
    expect(hasItemType(out, 'Exif')).toBe(false);
    expect(getIlocItemCount(out)).toBe(1);
  });

  it('output file is smaller than input', () => {
    const file = buildIsobmffFile({ exifData: new Uint8Array(64), mdatFirst: true });
    expect(stripExifItem(file).length).toBeLessThan(file.length);
  });
});

// ── HEIC / AVIF supports() — extension fallback ───────────────────────────────

describe('heicStripper.supports', () => {
  it('accepts image/heic MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'heic' });
    const file = new File([data], 'photo.heic', { type: 'image/heic' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(true);
  });

  it('accepts image/heif MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'mif1' });
    const file = new File([data], 'photo.heif', { type: 'image/heif' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(true);
  });

  it('accepts .heic extension with no MIME type (Linux missing MIME mapping)', async () => {
    const data = buildIsobmffFile({ brand: 'heic' });
    const file = new File([data], 'photo.heic', { type: '' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(true);
  });

  it('accepts .heif extension with application/octet-stream MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'mif1' });
    const file = new File([data], 'photo.heif', { type: 'application/octet-stream' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(true);
  });

  it('rejects a non-HEIC file even with .heic extension', async () => {
    const notHeic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    const file = new File([notHeic], 'photo.heic', { type: '' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(false);
  });

  it('rejects a file with no HEIC extension and no HEIC MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'heic' });
    const file = new File([data], 'photo.png', { type: 'image/png' });
    expect(await heicStripper.supports(file, mockCaps)).toBe(false);
  });
});

describe('avifStripper.supports', () => {
  it('accepts image/avif MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'avif', imageItemType: 'av01' });
    const file = new File([data], 'photo.avif', { type: 'image/avif' });
    expect(await avifStripper.supports(file, mockCaps)).toBe(true);
  });

  it('accepts .avif extension with no MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'avif', imageItemType: 'av01' });
    const file = new File([data], 'photo.avif', { type: '' });
    expect(await avifStripper.supports(file, mockCaps)).toBe(true);
  });

  it('accepts .avif extension with application/octet-stream MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'avif', imageItemType: 'av01' });
    const file = new File([data], 'photo.avif', { type: 'application/octet-stream' });
    expect(await avifStripper.supports(file, mockCaps)).toBe(true);
  });

  it('rejects a non-AVIF brand even with .avif extension', async () => {
    const data = buildIsobmffFile({ brand: 'heic' }); // HEIC brand, not AVIF
    const file = new File([data], 'photo.avif', { type: '' });
    expect(await avifStripper.supports(file, mockCaps)).toBe(false);
  });

  it('rejects a file with no AVIF extension and no AVIF MIME type', async () => {
    const data = buildIsobmffFile({ brand: 'avif', imageItemType: 'av01' });
    const file = new File([data], 'photo.png', { type: 'image/png' });
    expect(await avifStripper.supports(file, mockCaps)).toBe(false);
  });
});

// ── readExifBytes ─────────────────────────────────────────────────────────────

function makeTiff(le = false): Uint8Array {
  // Minimal TIFF: byte-order mark + magic + IFD offset pointing past end (no entries)
  return le
    ? new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00])
    : new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00]);
}

function exifPayload(tiff: Uint8Array, offset = 0): Uint8Array {
  // ISO 23008-12 §6.6.1: 4-byte big-endian offset, then optional prefix bytes, then TIFF
  const prefix = new Uint8Array(offset); // zero-filled filler before TIFF
  const buf = new Uint8Array(4 + offset + tiff.length);
  buf[2] = (offset >>> 8) & 0xff;
  buf[3] = offset & 0xff;
  buf.set(prefix, 4);
  buf.set(tiff, 4 + offset);
  return buf;
}

describe('readExifBytes', () => {
  it('returns null for non-ISOBMFF data', () => {
    expect(readExifBytes(new Uint8Array(64))).toBeNull();
  });

  it('returns null when no Exif item is present', () => {
    const data = buildIsobmffFile({ exifData: null });
    expect(readExifBytes(data)).toBeNull();
  });

  it('extracts TIFF bytes with offset=0', () => {
    const tiff = makeTiff();
    const data = buildIsobmffFile({ exifData: exifPayload(tiff, 0) });
    expect(readExifBytes(data)).toEqual(tiff);
  });

  it('respects a non-zero 4-byte offset (e.g. Exif\\0\\0 prefix)', () => {
    const tiff = makeTiff(true);
    // offset=6 means 6 filler bytes before TIFF (mimics "Exif\0\0" prefix in some files)
    const data = buildIsobmffFile({ exifData: exifPayload(tiff, 6) });
    expect(readExifBytes(data)).toEqual(tiff);
  });

  it('works with mdat-first layout', () => {
    const tiff = makeTiff();
    const data = buildIsobmffFile({ exifData: exifPayload(tiff), mdatFirst: true });
    expect(readExifBytes(data)).toEqual(tiff);
  });

  it('returns null when the 4-byte offset points past the item end', () => {
    // Payload is only 4 bytes (the offset itself), pointing to offset 999 which is out of range
    const bad = new Uint8Array([0x00, 0x00, 0x03, 0xe7]); // offset = 999
    const data = buildIsobmffFile({ exifData: bad });
    expect(readExifBytes(data)).toBeNull();
  });
});
