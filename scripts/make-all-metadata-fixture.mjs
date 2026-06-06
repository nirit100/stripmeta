// Generates tests/fixtures/all-metadata.jpg — a JPEG with every metadata field
// that StripMeta surfaces in the UI (GPS, camera, serial, datetime, software, artist, comment).
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import piexif from 'piexifjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests/fixtures');

const base = readFileSync(join(fixtures, 'with-exif.jpg')).toString('binary');

function toRational(decimal) {
  const deg = Math.floor(decimal);
  const minDec = (decimal - deg) * 60;
  const min = Math.floor(minDec);
  const sec = Math.round((minDec - min) * 60 * 1000);
  return [[deg, 1], [min, 1], [sec, 1000]];
}

const exifObj = {
  '0th': {
    [piexif.ImageIFD.Make]: 'Apple',
    [piexif.ImageIFD.Model]: 'iPhone 15 Pro',
    [piexif.ImageIFD.Software]: 'Lightroom Classic 13.0',
    [piexif.ImageIFD.DateTime]: '2024:03:15 14:32:00',
    [piexif.ImageIFD.Artist]: 'Jane Doe',
    [piexif.ImageIFD.Copyright]: 'Jane Doe 2024',
  },
  'Exif': {
    [piexif.ExifIFD.DateTimeOriginal]: '2024:03:15 14:32:00',
    [piexif.ExifIFD.BodySerialNumber]: 'F1A2B3C4D5',
    // UserComment: 8-byte ASCII header followed by the text
    [piexif.ExifIFD.UserComment]: 'ASCII\0\0\0Taken at the Eiffel Tower',
  },
  'GPS': {
    [piexif.GPSIFD.GPSLatitudeRef]: 'N',
    [piexif.GPSIFD.GPSLatitude]: toRational(48.8566),   // Paris
    [piexif.GPSIFD.GPSLongitudeRef]: 'E',
    [piexif.GPSIFD.GPSLongitude]: toRational(2.3522),
  },
  '1st': {},
};

const newJpeg = piexif.insert(piexif.dump(exifObj), base);
writeFileSync(join(fixtures, 'all-metadata.jpg'), Buffer.from(newJpeg, 'binary'));
console.log('Written: tests/fixtures/all-metadata.jpg');
