import { describe, it, expect } from 'vitest';
import { formatBytes, formatGps } from '../src/lib/util/format';

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(102400)).toBe('100.0 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(5242880)).toBe('5.0 MB');
  });
});

describe('formatGps', () => {
  it('formats northern and eastern coordinates', () => {
    expect(formatGps(48.8566, 2.3522)).toBe('48.8566°N 2.3522°E');
  });

  it('formats southern and western coordinates', () => {
    expect(formatGps(-33.8688, -70.6693)).toBe('33.8688°S 70.6693°W');
  });

  it('treats zero as N and E', () => {
    expect(formatGps(0, 0)).toBe('0.0000°N 0.0000°E');
  });

  it('handles mixed hemispheres', () => {
    expect(formatGps(-1.2921, 36.8219)).toBe('1.2921°S 36.8219°E');
  });
});
