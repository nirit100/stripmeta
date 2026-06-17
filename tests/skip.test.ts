import { describe, it, expect } from 'vitest';
import { getSkipReason, skipStatusLabel } from '../src/lib/domain/skip';
import type { SkipSettings } from '../src/lib/domain/skip';
import type { MetadataPreview } from '../src/lib/stripMeta';
import type { WarningLevel } from '../src/lib/strippers/types';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

const emptyMeta: MetadataPreview = {
  gps: null, make: null, model: null, serialNumber: null,
  software: null, dateTime: null, artist: null, userComment: null,
  hasAnyMetadata: false,
};

const allOn: SkipSettings = { paranoid: false, skipUnsupported: true, skipExperimental: true, skipClean: true };
const allOff: SkipSettings = { paranoid: false, skipUnsupported: false, skipExperimental: false, skipClean: false };

describe('getSkipReason', () => {
  describe('skipUnsupported', () => {
    it('returns "unsupported" when level is unsupported and setting is on', () => {
      const file = makeFile();
      const levelOf = new Map<File, WarningLevel>([[file, 'unsupported']]);
      expect(getSkipReason(file, allOn, levelOf, new Map())).toBe('unsupported');
    });

    it('returns "lossy" when level is lossy, setting is on, and paranoid is off', () => {
      const file = makeFile();
      const levelOf = new Map<File, WarningLevel>([[file, 'lossy']]);
      expect(getSkipReason(file, allOn, levelOf, new Map())).toBe('lossy');
    });

    it('does NOT skip lossy when paranoid mode is on', () => {
      const file = makeFile();
      const levelOf = new Map<File, WarningLevel>([[file, 'lossy']]);
      const settings: SkipSettings = { paranoid: true, skipUnsupported: true, skipExperimental: true, skipClean: false };
      expect(getSkipReason(file, settings, levelOf, new Map())).toBeNull();
    });

    it('does not skip when skipUnsupported is off even if level is unsupported', () => {
      const file = makeFile();
      const levelOf = new Map<File, WarningLevel>([[file, 'unsupported']]);
      expect(getSkipReason(file, allOff, levelOf, new Map())).toBeNull();
    });

    it('does not skip files with level "none"', () => {
      const file = makeFile();
      const levelOf = new Map<File, WarningLevel>([[file, 'none']]);
      expect(getSkipReason(file, allOn, levelOf, new Map())).toBeNull();
    });
  });

  describe('skipClean', () => {
    it('returns "no-metadata" when metadata is cached and all fields are null', () => {
      const file = makeFile();
      const cache = new Map<File, MetadataPreview>([[file, emptyMeta]]);
      expect(getSkipReason(file, allOn, new Map(), cache)).toBe('no-metadata');
    });

    it('does not skip when metadata has GPS', () => {
      const file = makeFile();
      const meta: MetadataPreview = { ...emptyMeta, gps: { latitude: 1, longitude: 2 }, hasAnyMetadata: true };
      const cache = new Map<File, MetadataPreview>([[file, meta]]);
      expect(getSkipReason(file, allOn, new Map(), cache)).toBeNull();
    });

    it('does not skip when metadata has artist', () => {
      const file = makeFile();
      const meta: MetadataPreview = { ...emptyMeta, artist: 'Jane Doe', hasAnyMetadata: true };
      const cache = new Map<File, MetadataPreview>([[file, meta]]);
      expect(getSkipReason(file, allOn, new Map(), cache)).toBeNull();
    });

    it('does not skip when metadata has userComment', () => {
      const file = makeFile();
      const meta: MetadataPreview = { ...emptyMeta, userComment: 'Hello', hasAnyMetadata: true };
      const cache = new Map<File, MetadataPreview>([[file, meta]]);
      expect(getSkipReason(file, allOn, new Map(), cache)).toBeNull();
    });

    it('does not skip when metadata is not yet cached', () => {
      const file = makeFile();
      const settings: SkipSettings = { paranoid: false, skipUnsupported: false, skipExperimental: false, skipClean: true };
      expect(getSkipReason(file, settings, new Map(), new Map())).toBeNull();
    });

    it('does not skip clean files when skipClean is off', () => {
      const file = makeFile();
      const cache = new Map<File, MetadataPreview>([[file, emptyMeta]]);
      expect(getSkipReason(file, allOff, new Map(), cache)).toBeNull();
    });
  });

  it('returns null when all settings are off', () => {
    const file = makeFile();
    const levelOf = new Map<File, WarningLevel>([[file, 'unsupported']]);
    const cache = new Map<File, MetadataPreview>([[file, emptyMeta]]);
    expect(getSkipReason(file, allOff, levelOf, cache)).toBeNull();
  });
});

describe('skipStatusLabel', () => {
  it('hides the badge for unsupported (covered by the red ✕ badge)', () => {
    expect(skipStatusLabel('unsupported')).toEqual({ hidden: true, text: '' });
  });

  it('labels each skip reason', () => {
    expect(skipStatusLabel('lossy')).toEqual({ hidden: false, text: 'Skipped — lossy only' });
    expect(skipStatusLabel('experimental')).toEqual({ hidden: false, text: 'Skipped — experimental' });
    expect(skipStatusLabel('no-metadata')).toEqual({ hidden: false, text: 'Skipped — no metadata' });
  });

  it('shows "Ready" for a non-skipped (null) file', () => {
    expect(skipStatusLabel(null)).toEqual({ hidden: false, text: 'Ready' });
  });
});
