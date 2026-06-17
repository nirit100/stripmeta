import { describe, it, expect } from 'vitest';
import { StripState } from '../src/lib/state/stripState';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}
function blob(): Blob {
  return new Blob(['stripped'], { type: 'image/jpeg' });
}

describe('StripState', () => {
  it('starts with all collections empty', () => {
    const s = new StripState();
    const f = makeFile();
    expect(s.done.has(f)).toBe(false);
    expect(s.errored.has(f)).toBe(false);
    expect(s.blobs.has(f)).toBe(false);
  });

  // ─── markDone ───────────────────────────────────────────────────────────────

  describe('markDone', () => {
    it('adds the file to done and stores the blob', () => {
      const s = new StripState();
      const f = makeFile();
      const b = blob();
      s.markDone(f, b);
      expect(s.done.has(f)).toBe(true);
      expect(s.blobs.get(f)).toBe(b);
    });

    it('removes the file from errored', () => {
      const s = new StripState();
      const f = makeFile();
      s.markError(f);
      s.markDone(f, blob());
      expect(s.errored.has(f)).toBe(false);
    });

    it('overwrites a previous blob for the same file', () => {
      const s = new StripState();
      const f = makeFile();
      const b1 = blob();
      const b2 = blob();
      s.markDone(f, b1);
      s.markDone(f, b2);
      expect(s.blobs.get(f)).toBe(b2);
    });
  });

  // ─── markError ──────────────────────────────────────────────────────────────

  describe('markError', () => {
    it('adds the file to errored', () => {
      const s = new StripState();
      const f = makeFile();
      s.markError(f);
      expect(s.errored.has(f)).toBe(true);
    });

    it('does not add the file to done or blobs', () => {
      const s = new StripState();
      const f = makeFile();
      s.markError(f);
      expect(s.done.has(f)).toBe(false);
      expect(s.blobs.has(f)).toBe(false);
    });
  });

  // ─── resetErrors ────────────────────────────────────────────────────────────

  describe('resetErrors', () => {
    it('clears all errored files', () => {
      const s = new StripState();
      s.markError(makeFile('a.jpg'));
      s.markError(makeFile('b.jpg'));
      s.resetErrors();
      expect(s.errored.size).toBe(0);
    });

    it('leaves done files and blobs untouched', () => {
      const s = new StripState();
      const f = makeFile();
      const b = blob();
      s.markDone(f, b);
      s.resetErrors();
      expect(s.done.has(f)).toBe(true);
      expect(s.blobs.get(f)).toBe(b);
    });
  });

  // ─── invalidate ─────────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('clears done, errored, and blobs all at once', () => {
      const s = new StripState();
      const f1 = makeFile('a.jpg');
      const f2 = makeFile('b.jpg');
      s.markDone(f1, blob());
      s.markError(f2);
      s.invalidate();
      expect(s.done.size).toBe(0);
      expect(s.errored.size).toBe(0);
      expect(s.blobs.size).toBe(0);
    });
  });

  // ─── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a file from all three collections', () => {
      const s = new StripState();
      const f = makeFile();
      s.markDone(f, blob());
      s.markError(f);
      s.remove(f);
      expect(s.done.has(f)).toBe(false);
      expect(s.errored.has(f)).toBe(false);
      expect(s.blobs.has(f)).toBe(false);
    });

    it('does not affect other files', () => {
      const s = new StripState();
      const f1 = makeFile('a.jpg');
      const f2 = makeFile('b.jpg');
      const b2 = blob();
      s.markDone(f1, blob());
      s.markDone(f2, b2);
      s.remove(f1);
      expect(s.done.has(f2)).toBe(true);
      expect(s.blobs.get(f2)).toBe(b2);
    });

    it('is a no-op for a file that was never tracked', () => {
      const s = new StripState();
      expect(() => s.remove(makeFile())).not.toThrow();
    });
  });
});
