import { describe, it, expect } from 'vitest';
import {
  stepIndex, clampScale, clampPan,
  MIN_SCALE, MAX_SCALE,
} from '../src/scripts/lightbox';

// These are the pure helpers behind the photo viewer's navigation and zoom/pan.
// The DOM controller and gesture wiring are exercised by hand (see verify), but
// the index math and clamping — where off-by-ones and sign errors hide — are unit
// tested here.

// ─── stepIndex (prev/next with wrap-around) ────────────────────────────────────

describe('stepIndex', () => {
  it('advances forward', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(1, 3, 1)).toBe(2);
  });

  it('wraps forward past the end to the start', () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it('goes backward', () => {
    expect(stepIndex(2, 3, -1)).toBe(1);
  });

  it('wraps backward past the start to the end', () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('stays put with a single item', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });

  it('is safe on an empty list', () => {
    expect(stepIndex(0, 0, 1)).toBe(0);
    expect(stepIndex(0, 0, -1)).toBe(0);
  });
});

// ─── clampScale ────────────────────────────────────────────────────────────────

describe('clampScale', () => {
  it('passes through a value within range', () => {
    expect(clampScale(2.5)).toBe(2.5);
  });

  it('clamps below the minimum', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
  });

  it('clamps above the maximum', () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
  });

  it('honours custom bounds', () => {
    expect(clampScale(5, 2, 3)).toBe(3);
    expect(clampScale(1, 2, 3)).toBe(2);
  });
});

// ─── clampPan (keep the scaled image from drifting off-stage) ───────────────────

describe('clampPan', () => {
  // 100×100 image displayed in a 100×100 stage.
  const disp = { w: 100, h: 100, sw: 100, sh: 100 };

  it('pins to centre (0,0) when the image is not larger than the stage', () => {
    expect(clampPan(40, -30, 1, disp.w, disp.h, disp.sw, disp.sh)).toEqual([0, 0]);
  });

  it('allows pan up to half the overflow when zoomed', () => {
    // scale 2 → displayed 200, overflow 100, max offset 50 each side.
    expect(clampPan(80, 0, 2, disp.w, disp.h, disp.sw, disp.sh)).toEqual([50, 0]);
    expect(clampPan(-80, 0, 2, disp.w, disp.h, disp.sw, disp.sh)).toEqual([-50, 0]);
  });

  it('leaves an in-bounds offset untouched', () => {
    expect(clampPan(20, -10, 2, disp.w, disp.h, disp.sw, disp.sh)).toEqual([20, -10]);
  });

  it('clamps the x and y axes independently', () => {
    // Wide image (200×100) in a square stage: x can pan, y cannot.
    expect(clampPan(999, 999, 1, 200, 100, 100, 100)).toEqual([50, 0]);
  });

  it('widens the bounds as scale grows', () => {
    const [x2] = clampPan(999, 0, 2, disp.w, disp.h, disp.sw, disp.sh);
    const [x4] = clampPan(999, 0, 4, disp.w, disp.h, disp.sw, disp.sh);
    expect(x4).toBeGreaterThan(x2);
  });
});
