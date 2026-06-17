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
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
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
/** infe v2 for a 'mime' item: includes item_name(\0) + content_type(\0) */
function mimeInfeBox(itemId: number, contentType: string): Uint8Array {
  const ct = new TextEncoder().encode(contentType);
  return fullBoxWrap('infe', 2, concat(
    u16be(itemId), u16be(0), str4('mime'),
    new Uint8Array([0]),  // item_name = ""
    ct, new Uint8Array([0]), // content_type + null
  ));
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
/**
 * iref v0: contains SingleItemTypeReferenceBox children.
 * Each entry is a plain Box (not FullBox) with type=refType, content=
 *   from_item_ID(u16) + reference_count(u16) + to_item_ID[](u16)
 */
function irefBox(refs: { type: string; fromId: number; toIds: number[] }[]): Uint8Array {
  const subBoxes = refs.map(({ type, fromId, toIds }) =>
    boxWrap(type, concat(u16be(fromId), u16be(toIds.length), ...toIds.map(id => u16be(id)))),
  );
  return fullBoxWrap('iref', 0, concat(...subBoxes));
}

export interface BuildOpts {
  brand?: string;
  imageItemType?: string;
  imageData?: Uint8Array;
  /** Include an Exif item with this payload. Pass null/undefined for no Exif. */
  exifData?: Uint8Array | null;
  /** Include a XMP 'mime' item (content_type=application/rdf+xml) with this payload. */
  xmpData?: Uint8Array | null;
  /**
   * iref entries to include in the meta box.
   * Defaults to a cdsc reference from exif -> image when exifData is provided.
   * Pass an empty array [] to suppress the default cdsc reference.
   * Pass entries explicitly to include custom references.
   */
  irefEntries?: { type: string; fromId: number; toIds: number[] }[] | null;
  /**
   * When true, emit mdat before meta (mdat-first layout).
   * iloc offsets point into the mdat that precedes the meta box.
   */
  mdatFirst?: boolean;
}

/**
 * Returns a fully formed synthetic ISOBMFF file with correct iloc offsets.
 */
export function buildIsobmffFile({
  brand = 'heic',
  imageItemType = 'hvc1',
  imageData,
  exifData,
  xmpData,
  irefEntries,
  mdatFirst = false,
}: BuildOpts = {}): Uint8Array<ArrayBuffer> {
  const img  = imageData ?? new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
  const exif = exifData ?? null;
  const xmp  = xmpData  ?? null;

  let nextId = 2;
  const exifId = exif ? nextId++ : null;
  const xmpId  = xmp  ? nextId++ : null;

  const infes: Uint8Array[] = [infeBox(1, imageItemType)];
  if (exif && exifId) infes.push(infeBox(exifId, 'Exif'));
  if (xmp  && xmpId)  infes.push(mimeInfeBox(xmpId, 'application/rdf+xml'));

  // Default iref: cdsc from exif item to image item (matches real HEIC files)
  let resolvedIref: { type: string; fromId: number; toIds: number[] }[] | null = null;
  if (irefEntries !== null) {
    if (irefEntries !== undefined) {
      resolvedIref = irefEntries;
    } else if (exif && exifId) {
      resolvedIref = [{ type: 'cdsc', fromId: exifId, toIds: [1] }];
    }
  }

  const ftyp  = ftypBox(brand);
  const hdlr  = hdlrBox();
  const iinfB = iinfBox(infes);
  const irefB = resolvedIref && resolvedIref.length > 0 ? irefBox(resolvedIref) : null;

  if (mdatFirst) {
    // Layout: ftyp + mdat + meta
    // iloc offsets are absolute within the file, pointing into mdat (before meta).
    const mdatContent = concat(img, ...(exif ? [exif] : []), ...(xmp ? [xmp] : []));
    const mdatBoxBytes = boxWrap('mdat', mdatContent);
    const mdatDataStart = ftyp.length + 8; // right after mdat box header

    const ilocEntries: { itemId: number; offset: number; length: number }[] = [
      { itemId: 1, offset: mdatDataStart, length: img.length },
    ];
    let off = mdatDataStart + img.length;
    if (exif && exifId) { ilocEntries.push({ itemId: exifId, offset: off, length: exif.length }); off += exif.length; }
    if (xmp  && xmpId)  { ilocEntries.push({ itemId: xmpId,  offset: off, length: xmp.length  });                    }

    const metaParts = [hdlr, iinfB, ilocBox(ilocEntries)];
    if (irefB) metaParts.push(irefB);
    const metaFinal = fullBoxWrap('meta', 0, concat(...metaParts));

    return concat(ftyp, mdatBoxBytes, metaFinal);
  }

  // Default layout: ftyp + meta + mdat

  // Build a placeholder meta to determine its size before we know absolute offsets.
  const placeholderEntries: { itemId: number; offset: number; length: number }[] = [
    { itemId: 1, offset: 0, length: img.length },
  ];
  if (exif && exifId) placeholderEntries.push({ itemId: exifId, offset: 0, length: exif.length });
  if (xmp  && xmpId)  placeholderEntries.push({ itemId: xmpId,  offset: 0, length: xmp.length  });

  const placeholderParts = [hdlr, iinfB, ilocBox(placeholderEntries)];
  if (irefB) placeholderParts.push(irefB);
  const metaSize   = fullBoxWrap('meta', 0, concat(...placeholderParts)).length;
  const prefixSize = ftyp.length + metaSize + 8; // 8 = mdat box header

  // Rebuild iloc with correct absolute offsets.
  const patchedEntries: { itemId: number; offset: number; length: number }[] = [
    { itemId: 1, offset: prefixSize, length: img.length },
  ];
  let dataOff = prefixSize + img.length;
  if (exif && exifId) { patchedEntries.push({ itemId: exifId, offset: dataOff, length: exif.length }); dataOff += exif.length; }
  if (xmp  && xmpId)  { patchedEntries.push({ itemId: xmpId,  offset: dataOff, length: xmp.length  });                        }

  const finalParts = [hdlr, iinfB, ilocBox(patchedEntries)];
  if (irefB) finalParts.push(irefB);
  const metaFinal   = fullBoxWrap('meta', 0, concat(...finalParts));
  const mdatContent = concat(img, ...(exif ? [exif] : []), ...(xmp ? [xmp] : []));

  return concat(ftyp, metaFinal, boxWrap('mdat', mdatContent));
}
