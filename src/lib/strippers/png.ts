import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import type { StripperHandler } from './types.ts';

const METADATA_CHUNK_TYPES = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

export const pngStripper: StripperHandler = {
  name: 'PNG (lossless)',
  description: 'Removes metadata chunks (tEXt, iTXt, zTXt, eXIf, tIME) using png-chunks-extract/encode — no decode or re-encode of image data.',
  lossless: true,

  supports: async (file) => file.type === 'image/png',

  strip: async (file) => {
    const buffer = await file.arrayBuffer();
    const chunks = extract(new Uint8Array(buffer));
    const filtered = chunks.filter(c => !METADATA_CHUNK_TYPES.has(c.name));
    return new Blob([new Uint8Array(encode(filtered))], { type: 'image/png' });
  },
};
