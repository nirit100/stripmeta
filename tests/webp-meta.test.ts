import exifr from 'exifr';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'vitest';

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

describe('exifr WebP comparison', () => {
  it('pick mode', async () => {
    const r = await exifr.parse(fixtureFile('with-exif.webp', 'image/webp'), {
      pick: ['Make', 'Model', 'DateTimeOriginal'],
    }).catch((e: unknown) => ({ threw: (e as Error).message }));
    console.log('pick:', JSON.stringify(r));
  });
  it('true mode', async () => {
    const r = await exifr.parse(fixtureFile('with-exif.webp', 'image/webp'), true)
      .catch((e: unknown) => ({ threw: (e as Error).message }));
    console.log('true:', JSON.stringify(r));
  });
});
