import type { StripperHandler } from './types.ts';

// WebP uses a RIFF container. Metadata lives in named chunks (EXIF, XMP ).
// Extended WebP files (VP8X) carry a flags byte that advertises which chunks
// are present — we clear those bits after dropping the chunks.

const METADATA_CHUNK_TYPES = new Set(['EXIF', 'XMP ']);
const VP8X_EXIF_BIT = 0x08;
const VP8X_XMP_BIT  = 0x04;

function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;
}

function writeUint32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset]     =  value        & 0xFF;
  out[offset + 1] = (value >>  8) & 0xFF;
  out[offset + 2] = (value >> 16) & 0xFF;
  out[offset + 3] = (value >> 24) & 0xFF;
}

interface Chunk { fourcc: string; dataOffset: number; size: number; paddedSize: number; }

function stripWebp(buffer: ArrayBuffer): ArrayBuffer {
  const data = new Uint8Array(buffer);

  if (readFourCC(data, 0) !== 'RIFF' || readFourCC(data, 8) !== 'WEBP') {
    throw new Error('Not a valid WebP file');
  }

  // Parse all chunks after the 12-byte RIFF/WEBP header
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= data.length) {
    const fourcc     = readFourCC(data, pos);
    const size       = readUint32LE(data, pos + 4);
    const paddedSize = size + (size & 1); // RIFF chunks are padded to even boundaries
    chunks.push({ fourcc, dataOffset: pos + 8, size, paddedSize });
    pos += 8 + paddedSize;
  }

  const kept = chunks.filter(c => !METADATA_CHUNK_TYPES.has(c.fourcc));
  if (kept.length === chunks.length) return buffer; // nothing to strip

  // Rebuild the file
  const bodySize = kept.reduce((n, c) => n + 8 + c.paddedSize, 0);
  const out = new Uint8Array(12 + bodySize);

  // RIFF header
  out.set([82, 73, 70, 70], 0);               // "RIFF"
  writeUint32LE(out, 4, 4 + bodySize);         // file size = "WEBP" + chunks
  out.set([87, 69, 66, 80], 8);               // "WEBP"

  let outPos = 12;
  for (const chunk of kept) {
    // Copy fourcc + size header
    out.set(data.slice(chunk.dataOffset - 8, chunk.dataOffset), outPos);
    // Copy chunk data (including padding byte if present)
    out.set(data.slice(chunk.dataOffset, chunk.dataOffset + chunk.paddedSize), outPos + 8);
    outPos += 8 + chunk.paddedSize;
  }

  // Clear EXIF/XMP flags in VP8X if present
  const vp8xOut = kept.findIndex(c => c.fourcc === 'VP8X');
  if (vp8xOut !== -1) {
    const vp8xDataStart = 12 + kept.slice(0, vp8xOut).reduce((n, c) => n + 8 + c.paddedSize, 0) + 8;
    out[vp8xDataStart] &= ~(VP8X_EXIF_BIT | VP8X_XMP_BIT);
  }

  return out.buffer;
}

export const webpStripper: StripperHandler = {
  name: 'WebP (lossless)',
  description: 'Removes EXIF and XMP chunks from the WebP RIFF container without decoding or re-encoding the image bitstream.',
  lossless: true,

  supports: async (file) => {
    // Verify the RIFF....WEBP signature regardless of reported MIME type.
    // Catches WebP files with wrong extensions and rejects non-WebP claiming to be WebP.
    const sig = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    return sig[0] === 0x52 && sig[1] === 0x49 && sig[2] === 0x46 && sig[3] === 0x46 &&
           sig[8] === 0x57 && sig[9] === 0x45 && sig[10] === 0x42 && sig[11] === 0x50;
  },

  strip: async (file) => {
    const buffer = await file.arrayBuffer();
    return new Blob([stripWebp(buffer)], { type: 'image/webp' });
  },
};
