import type { FileEntry } from './stripPlan.ts';
import type { SkipReason } from './skip.ts';

export interface DirStats {
  /** Total files under the directory. */
  n: number;
  /** Files skipped for format reasons (unsupported / lossy / experimental). */
  incompatible: number;
  /** Files skipped because they have no metadata. */
  clean: number;
  /** Files that errored during stripping. */
  stripErrors: number;
  /** Files successfully stripped. */
  done: number;
  /** Files eligible to strip (total minus all skipped). */
  ready: number;
}

export interface DirStatsDeps {
  skipReason: (file: File) => SkipReason | null;
  done: Set<File>;
  errored: Set<File>;
}

/** Tallies per-status counts for the files under a directory. */
export function computeDirStats(under: FileEntry[], deps: DirStatsDeps): DirStats {
  let incompatible = 0, clean = 0, stripErrors = 0, done = 0;
  for (const e of under) {
    const r = deps.skipReason(e.file);
    if (r === 'unsupported' || r === 'lossy' || r === 'experimental') incompatible++;
    else if (r === 'no-metadata') clean++;
    if (deps.errored.has(e.file)) stripErrors++;
    if (deps.done.has(e.file))    done++;
  }
  const n = under.length;
  const ready = n - (incompatible + clean);
  return { n, incompatible, clean, stripErrors, done, ready };
}

/**
 * Formats the directory stat label, e.g. "5 files · 3 ready, 2 incompatible".
 * The status breakdown is only appended once classification has produced
 * levels (`hasLevels`); before that, just the file count is shown.
 */
export function formatDirStat(s: DirStats, hasLevels: boolean): string {
  let stat = `${s.n} file${s.n !== 1 ? 's' : ''}`;
  if (s.n > 0 && hasLevels) {
    const parts: string[] = [];
    if (s.ready > 0)        parts.push(`${s.ready} ready`);
    if (s.incompatible > 0) parts.push(`${s.incompatible} incompatible`);
    if (s.clean > 0)        parts.push(`${s.clean} no metadata`);
    if (s.stripErrors > 0)  parts.push(`${s.stripErrors} error${s.stripErrors !== 1 ? 's' : ''}`);
    stat += ' · ' + (parts.length ? parts.join(', ') : 'all skipped');
  }
  return stat;
}

/** Which status dot to show: red on any error, green once something is done, else none. */
export function dirStatusDot(s: DirStats): 'error' | 'done' | 'none' {
  if (s.stripErrors > 0) return 'error';
  if (s.done > 0)        return 'done';
  return 'none';
}

/** Whether to dim the directory row: classified, has files, but nothing is strippable. */
export function isDirDimmed(s: DirStats, hasLevels: boolean): boolean {
  return s.n > 0 && hasLevels && s.ready === 0;
}
