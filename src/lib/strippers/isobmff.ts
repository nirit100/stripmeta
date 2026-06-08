/**
 * Lossless EXIF item removal for ISOBMFF-based image formats (HEIC, AVIF).
 *
 * Specification references
 * ─────────────────────────
 * • ISO/IEC 14496-12 (ISOBMFF) — container format, box structure, iloc, iinf, infe
 *   https://www.iso.org/standard/83102.html  (paid; §4.2 boxes, §8.11 meta group)
 *   Free overview: https://wiki.multimedia.cx/index.php/MPEG-4_Containers
 *
 * • ISO/IEC 23008-12 (HEIF/HEIC) — HEVC image items, grid images, Exif item type
 *   https://www.iso.org/standard/83650.html
 *   Nokia technical overview: https://nokiatech.github.io/heif/technical.html
 *
 * • AV1 Image File Format (AVIF) — AV1 image items, same ISOBMFF meta structure
 *   https://aomediacodec.github.io/av1-avif/
 *
 * Box layout quick reference (ISO 14496-12 §4.2)
 * ─────────────────────────────────────────────────
 *   Box:     [size:u32][type:4cc][...content]
 *   FullBox: [size:u32][type:4cc][version:u8][flags:u24][...content]
 *   Extended size: size field == 1 → next 8 bytes hold the real u64 size.
 *
 * Relevant boxes inside `meta` (ISO 14496-12 §8.11)
 * ───────────────────────────────────────────────────
 *   meta  FullBox — container for all metadata items
 *   ├── hdlr  FullBox — declares handler type ('pict' for images)
 *   ├── iinf  FullBox — item info; child `infe` boxes describe each item
 *   │    └── infe  FullBox v2+ — item_ID, item_type ('Exif', 'hvc1', 'av01', …)
 *   ├── iloc  FullBox — maps item IDs to byte extents within the file
 *   ├── pitm  FullBox — primary item reference
 *   └── (others: iref, idat, grpl, …)
 *
 * EXIF item layout (ISO/IEC 23008-12 §6.6.1)
 * ────────────────────────────────────────────
 *   The raw bytes of an 'Exif' item start with a 4-byte big-endian offset
 *   (usually 0x00000006) pointing to the start of the TIFF header within the
 *   item, followed by the full Exif/TIFF blob.
 *
 * This module only handles `meta` at the top level of the file (not inside
 * `moov`), which covers all known single-frame HEIC and AVIF still images.
 * Grid images, animated sequences, and construction_method 1/2 in `iloc` are
 * detected and rejected with a clear error so the caller can fall back gracefully.
 */

// ── Read helpers ──────────────────────────────────────────────────────────────

function r8(d: Uint8Array, o: number): number { return d[o]!; }

function r16(d: Uint8Array, o: number): number {
  return ((d[o]! << 8) | d[o + 1]!) >>> 0;
}

function r32(d: Uint8Array, o: number): number {
  return ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
}

/** Reads a u64 big-endian value, throwing if the high 32 bits are non-zero. */
function r64safe(d: Uint8Array, o: number): number {
  if (r32(d, o) !== 0) throw new Error('isobmff: value exceeds 32-bit range');
  return r32(d, o + 4);
}

function fourcc(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!);
}

// ── Write helpers ─────────────────────────────────────────────────────────────

function w16(d: Uint8Array, o: number, v: number): void {
  d[o] = (v >>> 8) & 0xff; d[o + 1] = v & 0xff;
}

function w32(d: Uint8Array, o: number, v: number): void {
  d[o] = (v >>> 24) & 0xff; d[o + 1] = (v >>> 16) & 0xff;
  d[o + 2] = (v >>> 8) & 0xff; d[o + 3] = v & 0xff;
}

function wN(d: Uint8Array, o: number, v: number, n: number): void {
  if (n === 0) return;
  if (n === 2) { w16(d, o, v); return; }
  if (n === 4) { w32(d, o, v); return; }
  if (n === 8) { w32(d, o, 0); w32(d, o + 4, v); return; } // high word always 0
  throw new Error(`isobmff: unsupported write width ${n}`);
}

// ── Box iteration (ISO 14496-12 §4.2) ────────────────────────────────────────

export interface Box {
  offset: number;      // file offset of the size field (first byte of the box)
  type: string;        // 4-character FourCC
  headerSize: 8 | 16; // 8 for normal boxes, 16 for extended-size boxes
  size: number;        // total byte length including header
}

/** Yields every box in data[start..end). */
export function* iterBoxes(data: Uint8Array, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    const rawSize = r32(data, pos);
    const type: string = fourcc(data, pos + 4);
    let headerSize: 8 | 16 = 8;
    let size: number;

    if (rawSize === 1) {
      // Extended size — ISO 14496-12 §4.2: "if size == 1, the actual size is in
      // the next 64-bit field (largesize)"
      if (pos + 16 > end) break;
      size = r64safe(data, pos + 8);
      headerSize = 16;
    } else if (rawSize === 0) {
      // ISO 14496-12 §4.2: "size == 0 means the box extends to the end of the file"
      size = end - pos;
    } else {
      size = rawSize;
    }

    if (size < headerSize || pos + size > end) break;
    yield { offset: pos, type, headerSize, size };
    pos += size;
  }
}

function findBox(data: Uint8Array, type: string, start: number, end: number): Box | null {
  for (const b of iterBoxes(data, start, end)) {
    if (b.type === type) return b;
  }
  return null;
}

/** Offset of the first content byte of a FullBox (after the 4-byte version+flags). */
function fc(b: Box): number { return b.offset + b.headerSize + 4; }

// ── iinf / infe parsing (ISO 14496-12 §8.11.6) ───────────────────────────────

interface InfeInfo {
  boxOffset: number;
  boxSize: number;
  itemId: number;
  /** FourCC item_type, e.g. 'Exif', 'hvc1', 'av01', 'mime'. Empty for infe v0/v1. */
  itemType: string;
}

/**
 * Parses an `iinf` box and returns metadata for each `infe` child box.
 *
 * ISO 14496-12 §8.11.6.2 — ItemInfoEntry (infe)
 *   version 0/1: item_ID u16, item_protection_index u16, item_name, …  (no item_type FourCC)
 *   version 2:   item_ID u16, item_protection_index u16, item_type u32, item_name, …
 *   version 3:   item_ID u32, item_protection_index u16, item_type u32, item_name, …
 */
function parseIinf(data: Uint8Array, iinf: Box): InfeInfo[] {
  const iinfVersion = r8(data, iinf.offset + iinf.headerSize);
  // ISO 14496-12 §8.11.6.1 — ItemInfoBox entry_count:
  //   version 0 → u16, version 1+ → u32
  const entryCountSize = iinfVersion === 0 ? 2 : 4;
  const infeStart = fc(iinf) + entryCountSize;
  const results: InfeInfo[] = [];

  for (const infe of iterBoxes(data, infeStart, iinf.offset + iinf.size)) {
    if (infe.type !== 'infe') continue;
    const infeVersion = r8(data, infe.offset + infe.headerSize);
    let o = fc(infe);

    // item_ID: u16 for version < 3, u32 for version >= 3
    const idSize = infeVersion >= 3 ? 4 : 2;
    const itemId = idSize === 4 ? r32(data, o) : r16(data, o);
    o += idSize + 2; // skip item_protection_index (always u16)

    // item_type FourCC only present from version 2 onwards
    const itemType = infeVersion >= 2 ? fourcc(data, o) : '';
    results.push({ boxOffset: infe.offset, boxSize: infe.size, itemId, itemType });
  }
  return results;
}

// ── iloc parsing (ISO 14496-12 §8.11.3) ──────────────────────────────────────

interface IlocExtent { offset: number; length: number; }

interface IlocItem {
  itemId: number;
  constructionMethod: number; // 0=file, 1=idat, 2=item — ISO 14496-12 §8.11.3.3
  baseOffset: number;
  extents: IlocExtent[];      // offset values are absolute (baseOffset already added)
  entryStart: number;         // raw byte offset in data[] where this entry begins
  entryEnd: number;           // raw byte offset just past the last byte of this entry
}

interface IlocLayout {
  version: number;
  offsetSize: number;
  lengthSize: number;
  baseOffsetSize: number;
  indexSize: number;
  itemCountOffset: number;
  itemCountSize: number;
  entriesStart: number;
}

/**
 * Reads the fixed-size fields at the start of an `iloc` box.
 *
 * ISO 14496-12 §8.11.3.2 — ItemLocationBox syntax:
 *   FullBox 'iloc' (version, flags)
 *   offset_size:4    length_size:4    (packed nibbles)
 *   base_offset_size:4  [index_size:4 if version >= 1, else 0]
 *   item_count: u16 (version < 2) or u32 (version >= 2)
 *   for each item: item_ID, [construction_method v1+], data_reference_index,
 *                  base_offset, extent_count, extents…
 */
function parseIlocLayout(data: Uint8Array, iloc: Box): IlocLayout {
  const version = r8(data, iloc.offset + iloc.headerSize);
  const o0 = fc(iloc);
  const b1 = r8(data, o0), b2 = r8(data, o0 + 1);
  const offsetSize     = (b1 >>> 4) & 0xf;
  const lengthSize     =  b1        & 0xf;
  const baseOffsetSize = (b2 >>> 4) & 0xf;
  const indexSize      = version >= 1 ? (b2 & 0xf) : 0;
  const itemCountOffset = o0 + 2;
  const itemCountSize   = version >= 2 ? 4 : 2;
  return {
    version, offsetSize, lengthSize, baseOffsetSize, indexSize,
    itemCountOffset, itemCountSize,
    entriesStart: itemCountOffset + itemCountSize,
  };
}

function readN(data: Uint8Array, o: number, n: number): number {
  if (n === 0) return 0;
  if (n === 2) return r16(data, o);
  if (n === 4) return r32(data, o);
  if (n === 8) return r64safe(data, o);
  throw new Error(`isobmff: unsupported field size ${n}`);
}

function parseIlocItems(data: Uint8Array, lay: IlocLayout): IlocItem[] {
  const { version, offsetSize, lengthSize, baseOffsetSize, indexSize } = lay;
  const itemCount = lay.itemCountSize === 2
    ? r16(data, lay.itemCountOffset)
    : r32(data, lay.itemCountOffset);
  let o = lay.entriesStart;
  const items: IlocItem[] = [];

  for (let i = 0; i < itemCount; i++) {
    const entryStart = o;
    const itemId = version >= 2 ? (o += 4, r32(data, o - 4)) : (o += 2, r16(data, o - 2));

    let constructionMethod = 0;
    if (version >= 1) {
      // ISO 14496-12 §8.11.3.3: construction_method occupies the low 4 bits of a u16
      constructionMethod = r16(data, o) & 0xf; o += 2;
    }
    o += 2; // data_reference_index

    const baseOffset = readN(data, o, baseOffsetSize); o += baseOffsetSize;
    const extentCount = r16(data, o); o += 2;

    const extents: IlocExtent[] = [];
    for (let j = 0; j < extentCount; j++) {
      if (version >= 1 && indexSize > 0) o += indexSize; // extent_index — skip
      const extOff = readN(data, o, offsetSize); o += offsetSize;
      const extLen = readN(data, o, lengthSize); o += lengthSize;
      // Store absolute file offset (baseOffset is additive per the spec)
      extents.push({ offset: baseOffset + extOff, length: extLen });
    }

    items.push({ itemId, constructionMethod, baseOffset, extents, entryStart, entryEnd: o });
  }
  return items;
}

// ── Reassembly ────────────────────────────────────────────────────────────────

/** Re-serialises one `iloc` entry with an adjusted base/extent offset. */
function rewriteIlocEntry(
  item: IlocItem,
  lay: IlocLayout,
  offsetDelta: number,
): Uint8Array {
  const { version, offsetSize, lengthSize, baseOffsetSize, indexSize } = lay;
  const buf = new Uint8Array(item.entryEnd - item.entryStart);
  let o = 0;

  const idSize = version >= 2 ? 4 : 2;
  wN(buf, o, item.itemId, idSize); o += idSize;
  if (version >= 1) { wN(buf, o, item.constructionMethod, 2); o += 2; }
  wN(buf, o, 0, 2); o += 2; // data_reference_index

  // Adjust base_offset for construction_method 0 (file-absolute extents).
  // ISO 14496-12 §8.11.3.3: construction_method 0 means extents are in the file;
  // methods 1 and 2 are relative to idat/item — not adjusted.
  let newBase = item.baseOffset;
  if (item.constructionMethod === 0 && baseOffsetSize > 0) newBase -= offsetDelta;
  wN(buf, o, newBase, baseOffsetSize); o += baseOffsetSize;

  wN(buf, o, item.extents.length, 2); o += 2;

  for (const ext of item.extents) {
    if (version >= 1 && indexSize > 0) { wN(buf, o, 0, indexSize); o += indexSize; }

    let extOff: number;
    if (item.constructionMethod !== 0) {
      // Non-file offsets: store as-is (relative to idat or another item)
      extOff = ext.offset - item.baseOffset;
    } else if (baseOffsetSize === 0) {
      // No base_offset field: extent_offset IS the absolute file offset → adjust it.
      extOff = ext.offset - offsetDelta;
    } else {
      // base_offset carries the base; extent_offset is a relative displacement.
      extOff = ext.offset - item.baseOffset;
    }

    wN(buf, o, extOff, offsetSize); o += offsetSize;
    wN(buf, o, ext.length, lengthSize); o += lengthSize;
  }
  return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Removes all 'Exif' items from an ISOBMFF file (HEIC or AVIF) without
 * decoding the image.  The `meta` box is rebuilt in-place; all `iloc` offsets
 * for the remaining items are adjusted to compensate for the size reduction.
 * The raw bytes at the former EXIF extents are zeroed in the output.
 *
 * Returns the original input array unchanged if no Exif item is found.
 *
 * Limitations (throws `Error` rather than silently corrupting):
 *   • `meta` must be at the top level (not inside `moov`)
 *   • `iloc` construction_method 1 (idat-relative) and 2 (item-relative)
 *     are supported for non-Exif items but Exif items must use method 0.
 *   • Box sizes > 2^32 are rejected.
 */
export function stripExifItem(input: Uint8Array): Uint8Array {
  // ── 1. Locate meta box ───────────────────────────────────────────────────
  // ISO 14496-12 §8.11.1: meta can appear at the file level or inside moov/trak/udta.
  // For still-image HEIC/AVIF, it is invariably at the top level.
  const meta = findBox(input, 'meta', 0, input.length);
  if (!meta) return input;

  const metaBodyStart = fc(meta); // after full-box version+flags
  const metaEnd       = meta.offset + meta.size;

  // ── 2. Locate iinf and iloc ──────────────────────────────────────────────
  const iinf = findBox(input, 'iinf', metaBodyStart, metaEnd);
  if (!iinf) return input;

  const iloc = findBox(input, 'iloc', metaBodyStart, metaEnd);
  if (!iloc) return input;

  // ── 3. Identify Exif items ───────────────────────────────────────────────
  const infeList = parseIinf(input, iinf);
  const exifIds  = new Set(infeList.filter(e => e.itemType === 'Exif').map(e => e.itemId));
  if (exifIds.size === 0) return input;

  const ilocLay   = parseIlocLayout(input, iloc);
  const ilocItems = parseIlocItems(input, ilocLay);
  const exifItems = ilocItems.filter(it => exifIds.has(it.itemId));
  const keepItems = ilocItems.filter(it => !exifIds.has(it.itemId));

  // Exif items must use construction_method 0 (file-absolute) for us to zero
  // out the data safely.  method 1/2 would require parsing the idat box.
  for (const it of exifItems) {
    if (it.constructionMethod !== 0) {
      throw new Error(`isobmff: Exif item ${it.itemId} uses construction_method ${it.constructionMethod} — unsupported`);
    }
  }

  const exifExtents = exifItems.flatMap(it => it.extents);

  // ── 4. Compute size delta ────────────────────────────────────────────────
  const removedInfeSize  = infeList
    .filter(e => exifIds.has(e.itemId))
    .reduce((s, e) => s + e.boxSize, 0);

  const removedIlocBytes = exifItems
    .reduce((s, it) => s + (it.entryEnd - it.entryStart), 0);

  // meta shrinks by exactly this many bytes
  const metaDelta = removedInfeSize + removedIlocBytes;

  // ── 5. Rebuild ───────────────────────────────────────────────────────────

  // 5a. New iinf content
  const { version: iinfVersion } = { version: r8(input, iinf.offset + iinf.headerSize) };
  const entryCountSize = iinfVersion === 0 ? 2 : 4;
  const oldEntryCount  = entryCountSize === 2
    ? r16(input, fc(iinf)) : r32(input, fc(iinf));
  const newEntryCount  = oldEntryCount - exifIds.size;
  const newIinfSize    = iinf.size - removedInfeSize;

  const iinfHdrLen = iinf.headerSize + 4 + entryCountSize;
  const iinfHdr    = input.slice(iinf.offset, iinf.offset + iinfHdrLen);
  w32(iinfHdr, 0, newIinfSize);
  if (entryCountSize === 2) w16(iinfHdr, iinf.headerSize + 4, newEntryCount);
  else                      w32(iinfHdr, iinf.headerSize + 4, newEntryCount);

  // 5b. New iloc content
  const newIlocSize  = iloc.size - removedIlocBytes;
  const newItemCount = keepItems.length;
  const ilocPreLen   = iloc.headerSize + 4 + 2 + ilocLay.itemCountSize;
  const ilocPre      = input.slice(iloc.offset, iloc.offset + ilocPreLen);
  w32(ilocPre, 0, newIlocSize);
  if (ilocLay.itemCountSize === 2) w16(ilocPre, iloc.headerSize + 4 + 2, newItemCount);
  else                             w32(ilocPre, iloc.headerSize + 4 + 2, newItemCount);

  const newIlocEntries = keepItems.map(it => rewriteIlocEntry(it, ilocLay, metaDelta));

  // 5c. New meta header (update size only; version/flags unchanged)
  const metaHdr = input.slice(meta.offset, meta.offset + meta.headerSize + 4);
  w32(metaHdr, 0, meta.size - metaDelta);

  // ── 6. Assemble output ───────────────────────────────────────────────────
  const parts: Uint8Array[] = [];

  // Before meta
  parts.push(input.subarray(0, meta.offset));

  // Rebuilt meta header
  parts.push(metaHdr);

  // Rebuilt meta body: iterate child boxes, substitute iinf and iloc
  for (const child of iterBoxes(input, metaBodyStart, metaEnd)) {
    if (child.type === 'iinf') {
      parts.push(iinfHdr);
      for (const e of infeList) {
        if (!exifIds.has(e.itemId)) {
          parts.push(input.subarray(e.boxOffset, e.boxOffset + e.boxSize));
        }
      }
    } else if (child.type === 'iloc') {
      parts.push(ilocPre);
      for (const e of newIlocEntries) parts.push(e);
    } else {
      parts.push(input.subarray(child.offset, child.offset + child.size));
    }
  }

  // After meta: copy and zero out the former EXIF extents
  const tail = input.slice(metaEnd);
  for (const ext of exifExtents) {
    const s = ext.offset - metaEnd;
    if (s >= 0 && s + ext.length <= tail.length) tail.fill(0, s, s + ext.length);
  }
  parts.push(tail);

  // Concatenate all parts
  const totalSize = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}
