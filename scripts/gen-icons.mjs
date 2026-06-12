#!/usr/bin/env node
// Generates solid-color placeholder PWA icons.  Replace with real artwork.
// Usage: node scripts/gen-icons.mjs

import { crc32, deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const TEAL = [13, 148, 136]; // #0d9488 — brand mid-point

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const checksum = crc32(Buffer.concat([typeBytes, data]));
  const out = Buffer.allocUnsafe(4 + 4 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(checksum >>> 0, 8 + data.length);
  return out;
}

function solidPng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  // compression(0), filter(0), interlace(0) already zero

  const scanline = Buffer.allocUnsafe(1 + size * 3);
  scanline[0] = 0; // filter: None
  for (let i = 0; i < size; i++) {
    scanline[1 + i * 3] = r;
    scanline[2 + i * 3] = g;
    scanline[3 + i * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => scanline));
  const compressed = deflateSync(raw, { level: 6 });

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });

const sizes = [[192, '192.png'], [512, '512.png'], [180, 'apple-touch.png']];
for (const [size, filename] of sizes) {
  writeFileSync(`public/icons/${filename}`, solidPng(size, TEAL));
  console.log(`  → public/icons/${filename}`);
}
