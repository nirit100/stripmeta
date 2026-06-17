import type { FileEntry } from './stripPlan.ts';
import type { WarningLevel } from '../strippers/types.ts';
import type { SkipReason } from './skip.ts';

// Sort key for files within the same skip bucket: strippable first, then the
// more-degraded handlers last (unsupported < lossy < experimental < none).
const WARNING_ORDER: Record<WarningLevel, number> = { unsupported: 0, lossy: 1, experimental: 2, none: 3 };

/** True when no entry carries a directory path — i.e. the flat (non-tree) layout. */
export function isFlatMode(entries: FileEntry[]): boolean {
  return entries.every(e => !e.path.includes('/'));
}

export interface FlatSortDeps {
  skipReason: (file: File) => SkipReason | null;
  level: (file: File) => WarningLevel | undefined;
}

/**
 * Orders the flat file list: skippable files sink below strippable ones, and
 * within each group files sort by warning level. Returns a new array; the
 * input is not mutated.
 */
export function sortForFlatList(entries: FileEntry[], deps: FlatSortDeps): FileEntry[] {
  return [...entries].sort((a, b) => {
    const aSkip = deps.skipReason(a.file) !== null ? 1 : 0;
    const bSkip = deps.skipReason(b.file) !== null ? 1 : 0;
    if (aSkip !== bSkip) return aSkip - bSkip;
    return WARNING_ORDER[deps.level(a.file) ?? 'none'] - WARNING_ORDER[deps.level(b.file) ?? 'none'];
  });
}
