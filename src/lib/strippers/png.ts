import type { StripperHandler } from './types.ts';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Chunk types that carry metadata but have no effect on image rendering.
const METADATA_CHUNK_TYPES = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

function stripChunks(buffer: ArrayBuffer): ArrayBuffer {
  const data = new Uint8Array(buffer);

  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) throw new Error('Not a valid PNG file');
  }

  const kept: Uint8Array[] = [PNG_SIGNATURE];
  let offset = 8;

  while (offset < data.length) {
    const length = new DataView(buffer, offset, 4).getUint32(0);
    const type = String.fromCharCode(...Array.from(data.slice(offset + 4, offset + 8)));
    const chunkSize = 12 + length; // 4 length + 4 type + N data + 4 CRC

    if (!METADATA_CHUNK_TYPES.has(type)) {
      kept.push(data.slice(offset, offset + chunkSize));
    }

    offset += chunkSize;
  }

  const out = new Uint8Array(kept.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const chunk of kept) { out.set(chunk, pos); pos += chunk.length; }
  return out.buffer;
}

export const pngStripper: StripperHandler = {
  name: 'PNG (lossless)',
  description: 'Removes metadata chunks (tEXt, iTXt, zTXt, eXIf, tIME) from the PNG binary without decoding or re-encoding the image.',

  canHandle: (file) => file.type === 'image/png',

  strip: async (file) => {
    const buffer = await file.arrayBuffer();
    return new Blob([stripChunks(buffer)], { type: 'image/png' });
  },
};
