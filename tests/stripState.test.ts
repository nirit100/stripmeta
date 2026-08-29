import { describe, it, expect } from 'vitest';
import { StripState } from '../src/lib/state/stripState';

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}
function blob(): Blob {
  return new Blob(['stripped'], { type: 'image/jpeg' });
}

describe('StripState', () => {
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

    it('clears a previous error — a retry that succeeds is no longer failed', () => {
      const s = new StripState();
      const f = makeFile();
      s.markError(f);
      s.markDone(f, blob());
      expect(s.errored.has(f)).toBe(false);
      expect(s.done.has(f)).toBe(true);
    });

    it('replaces the stored blob on a re-strip, so no stale output is downloaded', () => {
      const s = new StripState();
      const f = makeFile();
      const stale = blob();
      const fresh = blob();
      s.markDone(f, stale);
      s.markDone(f, fresh);
      expect(s.blobs.get(f)).toBe(fresh);
    });
  });

  // ─── resetErrors ────────────────────────────────────────────────────────────

  describe('resetErrors', () => {
    it('clears errored files so the next run retries them', () => {
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

    it('removes only the named file — dismissing one card keeps the rest of the run', () => {
      const s = new StripState();
      const dropped = makeFile('a.jpg');
      const kept = makeFile('b.jpg');
      const keptBlob = blob();
      s.markDone(dropped, blob());
      s.markDone(kept, keptBlob);
      s.remove(dropped);
      expect(s.done.has(kept)).toBe(true);
      expect(s.blobs.get(kept)).toBe(keptBlob);
    });
  });
});
