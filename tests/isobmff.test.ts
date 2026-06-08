import { describe, it, expect } from 'vitest';
import { stripExifItem, iterBoxes } from '../src/lib/strippers/isobmff';
import { buildIsobmffFile } from './fixtures/isobmff';

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
  // iinf FullBox: header(8) + version/flags(4) → entry_count at +12
  return r16(data, iinf.offset + 12);
}

function getIlocItemCount(data: Uint8Array): number {
  const iloc = findBoxInside(data, 'meta', 'iloc');
  if (!iloc) return 0;
  // iloc FullBox: header(8) + version/flags(4) + nibbles(2) → item_count at +14
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
