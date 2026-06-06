// Tests that run against real fixture files using real exifr (no module mocking).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { readMetadata } from '../src/lib/stripMeta';

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

describe('readMetadata — all-metadata fixture', () => {
  it('reads GPS coordinates', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.gps).not.toBeNull();
    expect(result.gps!.latitude).toBeCloseTo(48.8566, 3);
    expect(result.gps!.longitude).toBeCloseTo(2.3522, 3);
  });

  it('reads camera make and model', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.make).toBe('Apple');
    expect(result.model).toBe('iPhone 15 Pro');
  });

  it('reads serial number', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.serialNumber).toBe('F1A2B3C4D5');
  });

  it('reads software', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.software).toBe('Lightroom Classic 13.0');
  });

  it('reads artist', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.artist).toBe('Jane Doe');
  });

  it('reads userComment with charset header stripped', async () => {
    const result = await readMetadata(fixtureFile('all-metadata.jpg', 'image/jpeg'));
    expect(result.userComment).toBe('Taken at the Eiffel Tower');
  });
});
