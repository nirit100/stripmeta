#!/usr/bin/env node
// Generates tests/fixtures/corrupt-exif.jpg — a minimal JPEG whose APP1/EXIF
// segment has the "Exif\0\0" header but then invalid TIFF data (wrong byte-order
// marker). exifr will find the segment, start parsing TIFF, and throw.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

// APP1 payload: "Exif\0\0" + corrupt TIFF (0xDEAD is not "II" or "MM")
const exifPayload = new Uint8Array([
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x2A, // invalid TIFF byte-order marker
  0x00, 0x00, 0x00, 0x08,              // IFD offset (points nowhere useful)
]);

// APP1 length includes the 2-byte length field itself
const app1Len = 2 + exifPayload.length;

const bytes = new Uint8Array([
  0xFF, 0xD8,                          // JPEG SOI
  0xFF, 0xE1,                          // APP1 marker
  (app1Len >> 8) & 0xFF, app1Len & 0xFF,
  ...exifPayload,
  0xFF, 0xD9,                          // JPEG EOI
]);

writeFileSync(join(dir, 'corrupt-exif.jpg'), bytes);
console.log('→ tests/fixtures/corrupt-exif.jpg');
