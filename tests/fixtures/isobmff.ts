/**
 * Synthetic ISOBMFF fixture builder.
 *
 * Constructs minimal but valid ISOBMFF files in memory so the ISOBMFF parser
 * can be tested without real device images. The layout is:
 *
 *   ftyp [brand]
 *   meta (FullBox)
 *     hdlr (FullBox) — handler type 'pict'
 *     iinf (FullBox) — one image infe + optionally one Exif infe
 *     iloc (FullBox) — file-absolute extents, offset_size=4 length_size=4
 *   mdat — [imageData][exifData?]
 *
 * All sizes are computed from the content so iloc offsets are always correct.
 */

function u32be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}
function u16be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}
function str4(s: string): Uint8Array {
  return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}
function boxWrap(type: string, content: Uint8Array): Uint8Array {
  return concat(u32be(8 + content.length), str4(type), content);
}
function fullBoxWrap(type: string, version: number, content: Uint8Array): Uint8Array {
  return boxWrap(type, concat(new Uint8Array([version, 0, 0, 0]), content));
}

/** infe v2: item_ID(u16) item_protection_index(u16) item_type(4cc) name(\0) */
function infeBox(itemId: number, itemType: string): Uint8Array {
  return fullBoxWrap('infe', 2, concat(u16be(itemId), u16be(0), str4(itemType), new Uint8Array([0])));
}
/** iinf v0: entry_count(u16) [infe...] */
function iinfBox(infes: Uint8Array[]): Uint8Array {
  return fullBoxWrap('iinf', 0, concat(u16be(infes.length), ...infes));
}
/** iloc v0, offset_size=4, length_size=4: item_id(u16) dri(u16) ext_count(u16) off(u32) len(u32) */
function ilocBox(entries: { itemId: number; offset: number; length: number }[]): Uint8Array {
  const entryBytes = entries.flatMap(e => [
    u16be(e.itemId), u16be(0), u16be(1), u32be(e.offset), u32be(e.length),
  ]);
  return fullBoxWrap('iloc', 0, concat(
    new Uint8Array([0x44, 0x00]),
    u16be(entries.length),
    ...entryBytes,
  ));
}
/** hdlr v0: pre_defined(u32) handler_type(4cc) reserved(12) name(\0) */
function hdlrBox(): Uint8Array {
  return fullBoxWrap('hdlr', 0, concat(u32be(0), str4('pict'), u32be(0), u32be(0), u32be(0), new Uint8Array([0])));
}
/** ftyp: major_brand(4cc) minor_version(u32) [compat_brand...] */
function ftypBox(brand: string): Uint8Array {
  return boxWrap('ftyp', concat(str4(brand), u32be(0), str4(brand), str4('mif1')));
}

export interface BuildOpts {
  brand?: string;
  imageItemType?: string;
  imageData?: Uint8Array;
  /** Include an Exif item with this payload. Pass null/undefined for no Exif. */
  exifData?: Uint8Array | null;
}

/**
 * Returns a fully formed synthetic ISOBMFF file with correct iloc offsets.
 */
export function buildIsobmffFile({ brand = 'heic', imageItemType = 'hvc1', imageData, exifData }: BuildOpts = {}): Uint8Array {
  const img  = imageData ?? new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
  const exif = exifData ?? null;

  const infes = [infeBox(1, imageItemType)];
  if (exif) infes.push(infeBox(2, 'Exif'));

  const ftyp  = ftypBox(brand);
  const hdlr  = hdlrBox();
  const iinfB = iinfBox(infes);

  // Build a placeholder iloc to determine the meta box size before we know offsets.
  const placeholderEntries: { itemId: number; offset: number; length: number }[] = [
    { itemId: 1, offset: 0, length: img.length },
  ];
  if (exif) placeholderEntries.push({ itemId: 2, offset: 0, length: exif.length });

  const metaSize = fullBoxWrap('meta', 0, concat(hdlr, iinfB, ilocBox(placeholderEntries))).length;
  const prefixSize = ftyp.length + metaSize + 8; // 8 = mdat box header

  // Rebuild iloc with correct absolute offsets.
  const patchedEntries: { itemId: number; offset: number; length: number }[] = [
    { itemId: 1, offset: prefixSize, length: img.length },
  ];
  if (exif) patchedEntries.push({ itemId: 2, offset: prefixSize + img.length, length: exif.length });

  const metaFinal   = fullBoxWrap('meta', 0, concat(hdlr, iinfB, ilocBox(patchedEntries)));
  const mdatContent = exif ? concat(img, exif) : img;

  return concat(ftyp, metaFinal, boxWrap('mdat', mdatContent));
}
