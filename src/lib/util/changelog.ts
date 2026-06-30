// Pure changelog helpers shared by the timeline page and the "what's new"
// shell. No DOM — version math and selection only.

export interface ChangelogItem {
  text: string;
  /** Nested sub-bullets — a merged PR's branch commits. */
  details: string[];
}

export interface ChangelogSection {
  title: string;
  items: ChangelogItem[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string | null;
  sections: ChangelogSection[];
}

/**
 * Extract `[major, minor, patch]` from a version string, tolerating a leading
 * `v` and a `git describe` suffix (`v0.5.4-2-gabc123`, `0.5.4-dirty`).
 * Unparseable input → `[0, 0, 0]`.
 */
export function parseVersion(version: string): [number, number, number] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare two versions. Negative if a < b, positive if a > b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Entries strictly newer than `seen`, newest first. `seen` null/empty (a first
 * visit) yields none — new users shouldn't be shown a "what's new" reveal.
 */
export function entriesNewerThan(entries: ChangelogEntry[], seen: string | null): ChangelogEntry[] {
  if (!seen) return [];
  return entries
    .filter(e => compareVersions(e.version, seen) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}
