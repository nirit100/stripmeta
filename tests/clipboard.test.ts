import { describe, it, expect } from 'vitest';
import { copyFailLabel } from '../src/scripts/clipboard';

describe('copyFailLabel', () => {
  it('flags NotAllowedError as an unsupported-here message', () => {
    const err = new DOMException('denied', 'NotAllowedError');
    expect(copyFailLabel(err)).toBe("Can't copy images here");
  });

  it('returns a generic failure for other DOMExceptions', () => {
    const err = new DOMException('boom', 'DataError');
    expect(copyFailLabel(err)).toBe('Failed');
  });

  it('returns a generic failure for non-DOMException errors', () => {
    expect(copyFailLabel(new Error('toBlob failed'))).toBe('Failed');
    expect(copyFailLabel('nope')).toBe('Failed');
  });
});
