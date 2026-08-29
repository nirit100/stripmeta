import { describe, it, expect } from 'vitest';
import { statusBadge } from '../src/lib/view/statusBadge';
import type { StatusInput } from '../src/lib/view/statusBadge';
import type { SkipReason } from '../src/lib/domain/skip';

function input(over: Partial<StatusInput> = {}): StatusInput {
  return { done: false, errored: false, skipReason: null, includeSkipped: false, stripped: false, ...over };
}

const SKIP_REASONS: SkipReason[] = ['unsupported', 'lossy', 'experimental', 'no-metadata'];

describe('statusBadge precedence', () => {
  it('reports Done when stripped successfully', () => {
    const b = statusBadge(input({ done: true }));
    expect(b).toMatchObject({ hidden: false, text: 'Done', dimmed: false });
    expect(b.cls).toContain('badge-success');
  });

  it('reports Error when the strip failed', () => {
    const b = statusBadge(input({ errored: true }));
    expect(b).toMatchObject({ hidden: false, text: 'Error', dimmed: false });
    expect(b.cls).toContain('badge-error');
  });

  it('prefers Done over Error when both are set', () => {
    expect(statusBadge(input({ done: true, errored: true })).text).toBe('Done');
  });

  it('a done file is never dimmed or reported as skipped', () => {
    // Reachable: a file stripped before the user turned on a skip setting.
    const b = statusBadge(input({ done: true, skipReason: 'no-metadata', stripped: true }));
    expect(b.text).toBe('Done');
    expect(b.dimmed).toBe(false);
  });

  it('reports Ready when nothing applies', () => {
    expect(statusBadge(input())).toMatchObject({ hidden: false, text: 'Ready', dimmed: false });
  });
});

describe('skip reasons before a strip run', () => {
  it('names the reason rather than the outcome', () => {
    expect(statusBadge(input({ skipReason: 'lossy' })).text).toBe('Skipped — lossy only');
    expect(statusBadge(input({ skipReason: 'experimental' })).text).toBe('Skipped — experimental');
    expect(statusBadge(input({ skipReason: 'no-metadata' })).text).toBe('Skipped — no metadata');
  });

  it('hides the badge for unsupported files (the red ✕ badge already says it)', () => {
    expect(statusBadge(input({ skipReason: 'unsupported' })).hidden).toBe(true);
  });

  it('dims the row for any skip reason, including the hidden-badge one', () => {
    for (const reason of SKIP_REASONS) {
      expect(statusBadge(input({ skipReason: reason })).dimmed, reason).toBe(true);
    }
  });

  it('ignores includeSkipped before a run', () => {
    const off = statusBadge(input({ skipReason: 'lossy', includeSkipped: false }));
    const on  = statusBadge(input({ skipReason: 'lossy', includeSkipped: true }));
    expect(on.text).toBe(off.text);
  });
});

describe('skip reasons after a strip run', () => {
  it('reports the outcome rather than the reason, whatever the reason was', () => {
    for (const reason of SKIP_REASONS) {
      expect(statusBadge(input({ skipReason: reason, stripped: true })).text, reason).toBe('Skipped');
      expect(statusBadge(input({ skipReason: reason, stripped: true, includeSkipped: true })).text, reason).toBe('Copied');
    }
  });

  it('keeps the unsupported badge hidden after a run', () => {
    expect(statusBadge(input({ skipReason: 'unsupported', stripped: true })).hidden).toBe(true);
    expect(statusBadge(input({ skipReason: 'unsupported', stripped: true, includeSkipped: true })).hidden).toBe(true);
  });

  it('still shows Ready for a strippable file that produced no result', () => {
    expect(statusBadge(input({ stripped: true })).text).toBe('Ready');
  });
});

describe('badge classes', () => {
  it('uses the neutral outline class for every non-terminal state', () => {
    const neutral = 'badge badge-outline badge-sm status-badge';
    expect(statusBadge(input()).cls).toBe(neutral);
    for (const reason of SKIP_REASONS) {
      expect(statusBadge(input({ skipReason: reason })).cls).toBe(neutral);
      expect(statusBadge(input({ skipReason: reason, stripped: true })).cls).toBe(neutral);
    }
  });

  it('always carries the status-badge hook class', () => {
    const states = [
      input({ done: true }), input({ errored: true }), input(),
      ...SKIP_REASONS.map(r => input({ skipReason: r })),
    ];
    for (const s of states) expect(statusBadge(s).cls).toContain('status-badge');
  });
});
