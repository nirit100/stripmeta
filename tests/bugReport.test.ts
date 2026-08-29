import { describe, it, expect } from 'vitest';
import { REPORT_LIMITS, isPlausibleEmail, clampField } from '../shared/bugReport';

describe('isPlausibleEmail', () => {
  it.each([
    'a@b.co',
    'nico@ritti.ng',
    'first.last+tag@sub.example.com',
  ])('accepts %s', v => expect(isPlausibleEmail(v)).toBe(true));

  it.each([
    ['empty', ''],
    ['no at sign', 'nobody'],
    ['no domain dot', 'a@b'],
    ['no local part', '@b.co'],
    ['a bare space', 'a b@c.co'],
    ['a newline, which has no business in a header field', 'a@b.co\nBcc: x@y.co'],
    ['a carriage return', 'a@b.co\r\nBcc: x@y.co'],
    ['angle brackets', '<a@b.co>'],
    ['a comma separating two addresses', 'a@b.co,c@d.co'],
    ['a semicolon separating two addresses', 'a@b.co;c@d.co'],
    ['a one-letter TLD', 'a@b.c'],
  ])('rejects %s', (_label, v) => expect(isPlausibleEmail(v)).toBe(false));

  it('rejects an address longer than the RFC maximum', () => {
    expect(isPlausibleEmail('a'.repeat(250) + '@example.com')).toBe(false);
  });
});

describe('clampField', () => {
  it('leaves a field within the limit untouched', () => {
    const text = 'x'.repeat(REPORT_LIMITS.maxFieldChars);
    expect(clampField(text)).toBe(text);
  });

  it('truncates a longer field and says so', () => {
    const result = clampField('x'.repeat(REPORT_LIMITS.maxFieldChars + 5000));
    expect(result.length).toBeLessThan(REPORT_LIMITS.maxFieldChars + 100);
    expect(result.endsWith('… (truncated)')).toBe(true);
  });

  it('is a no-op for an empty field', () => {
    expect(clampField('')).toBe('');
  });
});

describe('REPORT_LIMITS', () => {
  it('are positive and small enough to be meaningful bounds', () => {
    expect(REPORT_LIMITS.maxAttachments).toBeGreaterThan(0);
    expect(REPORT_LIMITS.maxAttachmentBytes).toBeGreaterThan(0);
    // Cloudflare Pages Functions cap the request body at 100 MB; stay well under.
    expect(REPORT_LIMITS.maxAttachmentBytes).toBeLessThan(100 * 1024 * 1024);
  });
});
