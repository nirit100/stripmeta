import { describe, it, expect } from 'vitest';
import { computeBannerLines, type LevelCounts } from '../src/lib/banner';
import type { SkipSettings } from '../src/lib/skip';

function settings(over: Partial<SkipSettings> = {}): SkipSettings {
  return { paranoid: false, skipUnsupported: false, skipExperimental: false, skipClean: false, ...over };
}
function counts(over: Partial<LevelCounts> = {}): LevelCounts {
  return { lossy: 0, unsupported: 0, experimental: 0, ...over };
}

describe('computeBannerLines', () => {
  it('returns no lines when all counts are zero', () => {
    expect(computeBannerLines(counts(), settings())).toEqual([]);
  });

  it('reports unsupported files, pluralising correctly', () => {
    expect(computeBannerLines(counts({ unsupported: 1 }), settings())[0]).toContain('1 file cannot be processed');
    expect(computeBannerLines(counts({ unsupported: 3 }), settings())[0]).toContain('3 files cannot be processed');
  });

  describe('lossy', () => {
    it('says "will be skipped" when skipUnsupported is on and not paranoid', () => {
      const [line] = computeBannerLines(counts({ lossy: 2 }), settings({ skipUnsupported: true }));
      expect(line).toContain('2 files will be skipped');
      expect(line).toContain('their formats');
    });

    it('says "re-encoded as JPEG" when not skipping', () => {
      const [line] = computeBannerLines(counts({ lossy: 1 }), settings({ skipUnsupported: false }));
      expect(line).toContain('1 file will be re-encoded as JPEG');
      expect(line).toContain('its format');
    });

    it('attributes re-encoding to paranoid mode when paranoid', () => {
      const [line] = computeBannerLines(counts({ lossy: 1 }), settings({ paranoid: true, skipUnsupported: true }));
      expect(line).toContain('will be re-encoded as JPEG');
      expect(line).toContain('paranoid mode is enabled');
    });
  });

  describe('experimental', () => {
    it('says "will be skipped" when skipExperimental is on and not paranoid', () => {
      const [line] = computeBannerLines(counts({ experimental: 2 }), settings({ skipExperimental: true }));
      expect(line).toContain('2 files will be skipped');
      expect(line).toContain('(HEIC/AVIF) disabled in settings');
    });

    it('warns about the experimental handler otherwise', () => {
      const [line] = computeBannerLines(counts({ experimental: 1 }), settings({ skipExperimental: false }));
      expect(line).toContain('will use an experimental handler');
    });

    it('uses the experimental handler (not skip) when paranoid even if skipExperimental is set', () => {
      const [line] = computeBannerLines(counts({ experimental: 1 }), settings({ paranoid: true, skipExperimental: true }));
      expect(line).toContain('will use an experimental handler');
    });
  });

  it('emits lines in order: unsupported, lossy, experimental', () => {
    const lines = computeBannerLines(counts({ lossy: 1, unsupported: 1, experimental: 1 }), settings());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('cannot be processed');
    expect(lines[1]).toContain('re-encoded as JPEG');
    expect(lines[2]).toContain('experimental handler');
  });
});
