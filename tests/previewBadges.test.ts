import { describe, it, expect } from 'vitest';
import { buildPreviewBadges, formatPreviewDate, type PreviewBadge } from '../src/lib/previewBadges';
import type { MetadataPreview } from '../src/lib/stripMeta';

function preview(over: Partial<MetadataPreview> = {}): MetadataPreview {
  return {
    gps: null, make: null, model: null, serialNumber: null, software: null,
    dateTime: null, artist: null, userComment: null, hasAnyMetadata: false,
    ...over,
  };
}

const kinds = (b: PreviewBadge[]) => b.map(x => x.kind === 'gps' ? 'gps' : x.text);

describe('formatPreviewDate', () => {
  it('formats a Date via toDateString', () => {
    expect(formatPreviewDate(new Date('2026-01-02T03:04:05Z'))).toBe(new Date('2026-01-02T03:04:05Z').toDateString());
  });

  it('parses the colon-separated EXIF date string', () => {
    // "2026:01:02 03:04:05" -> valid date (not NaN), so we get a toDateString, not the raw string.
    const out = formatPreviewDate('2026:01:02 03:04:05');
    expect(out).not.toBe('2026:01:02 03:04:05');
    expect(out).toContain('2026');
  });

  it('falls back to the raw string for an unparseable value', () => {
    expect(formatPreviewDate('not a date')).toBe('not a date');
  });
});

describe('buildPreviewBadges', () => {
  it('returns no badges for an empty preview', () => {
    expect(buildPreviewBadges(preview())).toEqual([]);
  });

  it('emits a gps badge with formatted coordinates', () => {
    const [b] = buildPreviewBadges(preview({ gps: { latitude: 48.8566, longitude: 2.3522 } }));
    expect(b).toEqual({ kind: 'gps', lat: 48.8566, lon: 2.3522, coord: '48.8566°N 2.3522°E' });
  });

  it('combines make and model into one camera badge', () => {
    const [b] = buildPreviewBadges(preview({ make: 'Canon', model: 'EOS R5' }));
    expect(b).toMatchObject({ kind: 'plain', text: '📷 Canon EOS R5', tip: 'Canon EOS R5' });
  });

  it('shows the camera badge with only make or only model', () => {
    expect(buildPreviewBadges(preview({ make: 'Canon' }))[0]).toMatchObject({ text: '📷 Canon' });
    expect(buildPreviewBadges(preview({ model: 'EOS R5' }))[0]).toMatchObject({ text: '📷 EOS R5' });
  });

  it('marks serial number and artist as sensitive (warning/error classes)', () => {
    expect(buildPreviewBadges(preview({ serialNumber: 'SN123' }))[0]).toMatchObject({ cls: 'badge-warning', text: 'S/N', tip: 'SN123' });
    expect(buildPreviewBadges(preview({ artist: 'Jane' }))[0]).toMatchObject({ cls: 'badge-error max-w-[9rem]', text: '👤 Jane', tip: 'Jane' });
  });

  it('emits a date badge with no tooltip', () => {
    const [b] = buildPreviewBadges(preview({ dateTime: '2026:01:02 03:04:05' }));
    expect(b.kind).toBe('plain');
    expect((b as { tip?: string }).tip).toBeUndefined();
    expect((b as { text: string }).text.startsWith('📅 ')).toBe(true);
  });

  it('emits software, comment, and unreadable badges', () => {
    expect(buildPreviewBadges(preview({ software: 'GIMP' }))[0]).toMatchObject({ text: '🛠️ GIMP', tip: 'GIMP' });
    expect(buildPreviewBadges(preview({ userComment: 'hi' }))[0]).toMatchObject({ text: '💬 Comment', tip: 'hi' });
    expect(buildPreviewBadges(preview({ parseErrored: true }))[0]).toMatchObject({ text: '⚠ unreadable', tip: 'Metadata could not be parsed' });
  });

  it('preserves the fixed badge order when many fields are present', () => {
    const badges = buildPreviewBadges(preview({
      gps: { latitude: 1, longitude: 2 }, make: 'Canon', serialNumber: 'SN',
      dateTime: new Date('2026-01-01T00:00:00Z'), software: 'GIMP', artist: 'Jane',
      userComment: 'c', parseErrored: true,
    }));
    expect(kinds(badges)).toEqual([
      'gps', '📷 Canon', 'S/N',
      '📅 ' + formatPreviewDate(new Date('2026-01-01T00:00:00Z')),
      '🛠️ GIMP', '👤 Jane', '💬 Comment', '⚠ unreadable',
    ]);
  });
});
