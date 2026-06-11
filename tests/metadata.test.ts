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

  it('returns all nulls and hasAnyMetadata=false when exifr returns null', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect(await readMetadata(makeFile())).toEqual<MetadataPreview>({
      gps: null, make: null, model: null, serialNumber: null,
      software: null, dateTime: null, artist: null, userComment: null,
      hasAnyMetadata: false,
    });
  });

  it('sets parseErrored=true and hasAnyMetadata=false when exifr.parse throws', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockRejectedValue(new Error('parse error'));
    vi.mocked(exifr.default.gps).mockRejectedValue(new Error('gps error'));

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());
    expect(result.gps).toBeNull();
    expect(result.make).toBeNull();
    expect(result.parseErrored).toBe(true);
    // hasAnyMetadata is false — callers must check parseErrored before treating the file as clean
    expect(result.hasAnyMetadata).toBe(false);
  });

  it('leaves parseErrored undefined when exifr returns null (genuinely clean file)', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());
    expect(result.parseErrored).toBeUndefined();
    expect(result.hasAnyMetadata).toBe(false);
  });

  it('sets hasAnyMetadata=true when exifr returns data outside preview fields', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ Copyright: '(c) 2024 Studio' });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    const result = await readMetadata(makeFile());
    expect(result.hasAnyMetadata).toBe(true);
    expect(result.make).toBeNull(); // not in preview fields
  });

  it('sets hasAnyMetadata=true when exifr returns only binary blobs', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ MakerNote: new Uint8Array([1, 2, 3]) });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).hasAnyMetadata).toBe(true);
  });

  it('sets hasAnyMetadata=true when exifr returns an errors array (corrupt file)', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ errors: [new Error('IFD0 offset error')] });
    vi.mocked(exifr.default.gps).mockResolvedValue(undefined as never);

    const { readMetadata } = await importFresh();
    expect((await readMetadata(makeFile())).hasAnyMetadata).toBe(true);
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

  it('returns empty sections and no parseError when exifr returns null', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);

    const { readRichMetadata } = await importFresh();
    const result = await readRichMetadata(makeFile());
    expect(result.sections).toEqual([]);
    expect(result.parseError).toBeUndefined();
  });

  it('returns EXIF section with entries', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ Make: 'Apple', Model: 'iPhone 15' });

    const { readRichMetadata } = await importFresh();
    const { sections } = await readRichMetadata(makeFile());

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
    const { sections } = await readRichMetadata(makeFile());
    const keys = sections[0].entries.map(e => e.key);
    expect(keys).toContain('Make');
    expect(keys).not.toContain('MakerNote');
    expect(keys).not.toContain('NestedObj');
  });

  it('formats Date objects as ISO-like strings', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({ DateTimeOriginal: new Date('2024-03-15T14:32:00Z') });

    const { readRichMetadata } = await importFresh();
    const { sections } = await readRichMetadata(makeFile());
    const entry = sections[0].entries.find(e => e.key === 'DateTimeOriginal');
    expect(entry?.value).toBe('2024-03-15 14:32:00');
  });

  it('includes PNG text chunk section for PNG files', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue(null);

    const { readRichMetadata } = await importFresh();
    const file = fixtureFile('test.png', 'image/png');
    const { sections } = await readRichMetadata(file);

    const pngSection = sections.find(s => s.name === 'Text');
    expect(pngSection).toBeDefined();
    expect(pngSection!.entries.length).toBeGreaterThan(0);
  });

  it('sets parseError when exifr throws', async () => {
    const exifr = await import('exifr');
    const err = new Error('Unknown file format');
    vi.mocked(exifr.default.parse).mockRejectedValue(err);

    const { readRichMetadata } = await importFresh();
    const { sections, parseError } = await readRichMetadata(makeFile());
    expect(sections).toEqual([]);
    expect(parseError).toBe(err);
  });

  it('sets parseError when exifr returns an errors array', async () => {
    const exifr = await import('exifr');
    const err = new Error('IFD0 offset points to outside of file');
    vi.mocked(exifr.default.parse).mockResolvedValue({ errors: [err] });

    const { readRichMetadata } = await importFresh();
    const { sections, parseError } = await readRichMetadata(makeFile());
    expect(parseError).toBe(err);
    expect(sections).toEqual([]);
  });

  it('does not include the errors key as an EXIF entry', async () => {
    const exifr = await import('exifr');
    vi.mocked(exifr.default.parse).mockResolvedValue({
      Make: 'Canon',
      errors: [new Error('something went wrong')],
    });

    const { readRichMetadata } = await importFresh();
    const { sections } = await readRichMetadata(makeFile());
    const section = sections.find(s => s.name === 'EXIF / XMP / IPTC');
    expect(section).toBeDefined();
    expect(section!.entries.map(e => e.key)).not.toContain('errors');
  });

  it('sets parseError for corrupt-exif.jpg fixture (real exifr)', async () => {
    vi.doUnmock('exifr');
    vi.resetModules();
    const { readRichMetadata } = await import('../src/lib/stripMeta');
    const file = fixtureFile('corrupt-exif.jpg', 'image/jpeg');
    const { sections, parseError } = await readRichMetadata(file);
    expect(parseError).toBeInstanceOf(Error);
    expect(sections).toEqual([]);
  });

  it('returns rich metadata sections for rich-metadata.jpg fixture (real exifr)', async () => {
    vi.doUnmock('exifr');
    vi.resetModules();
    const { readRichMetadata } = await import('../src/lib/stripMeta');
    const file = fixtureFile('rich-metadata.jpg', 'image/jpeg');
    const { sections, parseError } = await readRichMetadata(file);
    expect(parseError).toBeUndefined();
    const exifSection = sections.find(s => s.name === 'EXIF / XMP / IPTC');
    expect(exifSection).toBeDefined();
    expect(exifSection!.entries.length).toBeGreaterThan(0);
  });
});
