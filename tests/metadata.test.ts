import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetadataPreview } from '../src/lib/stripMeta';

vi.mock('exifr', () => ({
  default: { parse: vi.fn(), gps: vi.fn() },
}));

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/stripMeta');
}

function makeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['fake'], name, { type });
}

function fixtureFile(filename: string, type: string): File {
  const buf = readFileSync(join(import.meta.dirname, 'fixtures', filename));
  return new File([buf], filename, { type });
}

describe('readMetadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all nulls when exifr returns null', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect(await readMetadata(makeFile())).toEqual<MetadataPreview>({
      gps: null, make: null, model: null, serialNumber: null,
      software: null, dateTime: null, artist: null, userComment: null,
    });
  });

  it('returns all nulls when exifr throws', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockRejectedValue(new Error('parse error'));
    vi.mocked(exifr.default.gps).mockRejectedValue(new Error('gps error'));

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());
    expect(result.gps).toBeNull();
    expect(result.make).toBeNull();
  });

  it('maps GPS, make, model, serial, software, dateTime from EXIF', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      Make: 'Apple', Model: 'iPhone 15 Pro', SerialNumber: 'ABC123',
      Software: 'iOS 17.0', DateTimeOriginal: '2024:01:15 12:00:00',
    });
    vi.mocked(exifr.default.gps).mockResolvedValue({ latitude: 48.8566, longitude: 2.3522 });

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());
    expect(result.gps).toEqual({ latitude: 48.8566, longitude: 2.3522 });
    expect(result.make).toBe('Apple');
    expect(result.model).toBe('iPhone 15 Pro');
    expect(result.serialNumber).toBe('ABC123');
    expect(result.software).toBe('iOS 17.0');
    expect(result.dateTime).toBe('2024:01:15 12:00:00');
  });

  it('maps artist field', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ Artist: 'Jane Doe' });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).artist).toBe('Jane Doe');
  });

  it('strips the ASCII charset header from UserComment', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      userComment: 'ASCII\x00\x00\x00Taken at the Eiffel Tower',
    });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).userComment).toBe('Taken at the Eiffel Tower');
  });

  it('strips UNICODE charset header from UserComment', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ userComment: 'UNICODE\x00Hello' });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).userComment).toBe('Hello');
  });

  it('returns null userComment when value is a Uint8Array (binary blob)', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ UserComment: new Uint8Array([1, 2, 3]) });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).userComment).toBeNull();
  });

  it('returns null gps when only latitude is present', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({});
    vi.mocked(exifr.default.gps).mockResolvedValue({ latitude: 48.8566 } as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).gps).toBeNull();
  });

  it('falls back to DateTime when DateTimeOriginal is absent', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ DateTime: '2023:06:01 08:00:00' });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).dateTime).toBe('2023:06:01 08:00:00');
  });

});

describe('readRichMetadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array when exifr returns null and file is not PNG', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);

    const { readRichMetadata } = await importFresh();
    expect(await readRichMetadata(makeFile())).toEqual([]);
  });

  it('returns EXIF section with entries', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ Make: 'Apple', Model: 'iPhone 15' });

    const { readRichMetadata } = await importFresh();
    const sections = await readRichMetadata(makeFile());

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('EXIF / XMP / IPTC');
    expect(sections[0].entries).toContainEqual({ key: 'Make', value: 'Apple' });
    expect(sections[0].entries).toContainEqual({ key: 'Model', value: 'iPhone 15' });
  });

  it('filters out binary blobs and nested objects from EXIF entries', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      Make: 'Sony',
      MakerNote: new Uint8Array([0, 1, 2]),
      NestedObj: { foo: 'bar' },
    });

    const { readRichMetadata } = await importFresh();
    const [section] = await readRichMetadata(makeFile());
    const keys = section.entries.map(e => e.key);
    expect(keys).toContain('Make');
    expect(keys).not.toContain('MakerNote');
    expect(keys).not.toContain('NestedObj');
  });

  it('formats Date objects as ISO-like strings', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ DateTimeOriginal: new Date('2024-03-15T14:32:00Z') });

    const { readRichMetadata } = await importFresh();
    const [section] = await readRichMetadata(makeFile());
    const entry = section.entries.find(e => e.key === 'DateTimeOriginal');
    expect(entry?.value).toBe('2024-03-15 14:32:00');
  });

  it('includes PNG text chunk section for PNG files', async () => {
    vi.restoreAllMocks();
    const { readRichMetadata } = await importFresh();
    const file = fixtureFile('test.png', 'image/png');
    const sections = await readRichMetadata(file);

    const pngSection = sections.find(s => s.name === 'Text');
    expect(pngSection).toBeDefined();
    expect(pngSection!.entries.length).toBeGreaterThan(0);
  });
});
