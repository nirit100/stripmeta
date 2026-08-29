import type { SkipReason } from '../domain/skip.ts';
import { skipStatusLabel } from '../domain/skip.ts';

export interface StatusInput {
  done: boolean;
  errored: boolean;
  skipReason: SkipReason | null;
  includeSkipped: boolean;
  /** True once a strip run has finished — switches skip labels to the outcome wording. */
  stripped: boolean;
}

export interface StatusBadge {
  hidden: boolean;
  text: string;
  cls: string;
  /** Whether the card is dimmed (nothing will be stripped from it). */
  dimmed: boolean;
}

const DONE_CLS    = 'badge badge-success badge-sm status-badge';
const ERROR_CLS   = 'badge badge-error badge-sm status-badge';
const NEUTRAL_CLS = 'badge badge-outline badge-sm status-badge';

/**
 * The file card's status badge, derived from strip state and skip settings.
 * Precedence: done → errored → skipped → ready.
 */
export function statusBadge(s: StatusInput): StatusBadge {
  if (s.done)    return { hidden: false, text: 'Done',  cls: DONE_CLS,  dimmed: false };
  if (s.errored) return { hidden: false, text: 'Error', cls: ERROR_CLS, dimmed: false };

  const dimmed = s.skipReason !== null;

  // Before a run the badge names the reason ("Skipped — lossy only"); after one
  // it reports what happened to the file instead.
  if (s.skipReason !== null && s.stripped) {
    return {
      hidden: s.skipReason === 'unsupported',
      text: s.includeSkipped ? 'Copied' : 'Skipped',
      cls: NEUTRAL_CLS,
      dimmed,
    };
  }

  const { hidden, text } = skipStatusLabel(s.skipReason);
  return { hidden, text, cls: NEUTRAL_CLS, dimmed };
}
