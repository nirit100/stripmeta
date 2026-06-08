#!/usr/bin/env node
// Generates tests/fixtures/rich-metadata.jpg — a JPEG with many EXIF fields,
// including several with very long text values that trigger the "show more" collapse
// in the metadata details modal.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const piexif  = require('piexifjs');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

// Use an existing JPEG as the carrier image.
const srcJpeg   = readFileSync(join(dir, 'with-exif.jpg'));
const dataUrl   = 'data:image/jpeg;base64,' + srcJpeg.toString('base64');
const stripped  = piexif.remove(dataUrl);

const I = piexif.ImageIFD;
const E = piexif.ExifIFD;
const G = piexif.GPSIFD;

const exifObj = {
  '0th': {
    [I.Make]:             'Sony',
    [I.Model]:            'ILCE-7CM2',
    [I.Software]:         'Adobe Lightroom Classic 13.4.0 (Windows)',
    [I.DateTime]:         '2024:06:15 14:32:10',
    [I.Artist]:           'Jane Doe',
    [I.Copyright]:
      '(c) 2024 Jane Doe Photography. All rights reserved. ' +
      'Unauthorized reproduction, modification, distribution, transmission, display, or use of ' +
      'this image in any form or by any means without the prior explicit written permission of ' +
      'the copyright holder is strictly prohibited and may result in legal action.',
    [I.ImageDescription]:
      'A scenic photograph taken during the summer solstice at the lakeside nature reserve ' +
      'just outside the city. The light was particularly beautiful that evening, casting long ' +
      'golden shadows across the still water. Several families of ducks were visible near the ' +
      'far shore. Exposure was challenging due to the high dynamic range between the bright sky ' +
      'and the shadowed foreground. Shot handheld at 1/500 s, f/2.8, ISO 400 with a 50 mm prime.',
  },
  Exif: {
    [E.DateTimeOriginal]:  '2024:06:15 14:32:10',
    [E.DateTimeDigitized]: '2024:06:15 14:32:10',
    [E.ExposureTime]:      [1, 500],
    [E.FNumber]:           [28, 10],
    [E.ISOSpeedRatings]:   400,
    [E.FocalLength]:       [50, 1],
    [E.FocalLengthIn35mmFilm]: 50,
    [E.Flash]:             0,
    [E.WhiteBalance]:      0,
    [E.ExposureMode]:      0,
    [E.ExposureProgram]:   3,
    [E.MeteringMode]:      5,
    [E.SceneCaptureType]:  0,
    [E.ColorSpace]:        1,
    [E.PixelXDimension]:   6000,
    [E.PixelYDimension]:   4000,
  },
  GPS: {
    [G.GPSLatitudeRef]:  'N',
    [G.GPSLatitude]:     [[48, 1], [8, 1], [1234, 100]],
    [G.GPSLongitudeRef]: 'E',
    [G.GPSLongitude]:    [[11, 1], [34, 1], [5678, 100]],
    [G.GPSAltitude]:     [520, 1],
    [G.GPSAltitudeRef]:  0,
  },
};

const exifBytes = piexif.dump(exifObj);
const result    = piexif.insert(exifBytes, stripped);
const outBuf    = Buffer.from(result.split(',')[1], 'base64');

writeFileSync(join(dir, 'rich-metadata.jpg'), outBuf);
console.log('→ tests/fixtures/rich-metadata.jpg');
