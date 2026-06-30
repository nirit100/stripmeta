// Pure changelog construction — no git, no filesystem, no DOM.
// The IO that feeds this (git tag/log reads, file writes) lives in
// scripts/gen-changelog.mjs; everything here is a pure transform so it can be
// unit-tested with plain data.

/** Conventional-commit type → human section title. Types absent here are dropped. */
const SECTION_FOR = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
};

/** Section render order within a version. */
const SECTION_ORDER = ['Features', 'Fixes', 'Performance'];

const SUBJECT_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

// GitHub PR merges: "Merge pull request #130 from owner/feat/some-branch-name".
// The branch ref after the owner carries a conventional `type/kebab-desc`, which
// is the meaningful summary of the PR — so merges are first-class changes here.
const MERGE_PR_RE = /^Merge pull request #\d+ from [^/\s]+\/(.+)$/;

/**
 * Parse a commit subject into a change. Handles both conventional commits
 * (`feat(scope): desc`) and PR-merge subjects (deriving type + description from
 * the merged branch name).
 * @param {string} subject
 * @returns {{ type: string, scope: string | null, description: string } | null}
 *   null when the subject carries no recognisable type.
 */
export function parseSubject(subject) {
  const trimmed = subject.trim();

  const merge = MERGE_PR_RE.exec(trimmed);
  if (merge) {
    const branch = merge[1];                 // e.g. feat/full-screen-photo-preview
    const slash = branch.indexOf('/');
    if (slash === -1) return null;           // no type prefix on the branch
    const type = branch.slice(0, slash).toLowerCase();
    const description = branch.slice(slash + 1).replace(/[-/]+/g, ' ').trim();
    if (!description) return null;
    return { type, scope: null, description };
  }

  const m = SUBJECT_RE.exec(trimmed);
  if (!m) return null;
  return { type: m[1].toLowerCase(), scope: m[2] ?? null, description: m[4].trim() };
}

/** Numeric semver compare on bare `x.y.z` strings (descending when used as sorter b - a). */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** True for a change whose type has a user-facing section. */
const isUserFacing = parsed => !!(parsed && SECTION_FOR[parsed.type]);

/**
 * @typedef {{ subject: string, children?: string[] }} Commit
 *   A mainline commit. `children` are the branch commit subjects a PR-merge
 *   brought in (empty/absent for direct commits).
 * @typedef {{ text: string, details: string[] }} Item
 *   One changelog bullet; `details` are nested sub-bullets (a merge's branch work).
 */

/**
 * Sort one version's commits into render sections, nesting a merged PR's branch
 * commits under its headline, and report what was dropped and why.
 * @param {Commit[]} commits in commit order (newest first)
 * @returns {{ sections: { title: string, items: Item[] }[], dropped: { subject: string, reason: string }[] }}
 *   `reason` is 'non-conventional' or the commit type with no user-facing section.
 */
export function categorize(commits) {
  /** @type {Map<string, Item[]>} */
  const buckets = new Map();
  /** @type {{ subject: string, reason: string }[]} */
  const dropped = [];
  const add = (title, item) => {
    if (!buckets.has(title)) buckets.set(title, []);
    buckets.get(title).push(item);
  };

  for (const commit of commits) {
    const head = parseSubject(commit.subject);
    const childChanges = (commit.children ?? []).map(parseSubject).filter(isUserFacing);

    if (isUserFacing(head)) {
      // Headline drives the section; user-facing branch commits become details.
      add(SECTION_FOR[head.type], { text: head.description, details: childChanges.map(c => c.description) });
    } else if (childChanges.length) {
      // Non-user-facing merge (e.g. a refactor branch) — don't lose a feature
      // hidden inside it; surface its user-facing children on their own.
      for (const c of childChanges) add(SECTION_FOR[c.type], { text: c.description, details: [] });
    } else {
      dropped.push({ subject: commit.subject, reason: head ? head.type : 'non-conventional' });
    }
  }

  const sections = SECTION_ORDER
    .filter(title => buckets.has(title))
    .map(title => ({ title, items: buckets.get(title) }));
  return { sections, dropped };
}

/**
 * Build the final changelog from raw per-version git data.
 * @param {{ version: string, date: string, body?: string, commits: Commit[] }[]} rawVersions
 *   `version` is a bare `x.y.z`. `body` is an annotated-tag message, when present.
 * @returns {{ version: string, date: string, notes: string | null, sections: { title: string, items: Item[] }[] }[]}
 *   newest version first.
 */
export function buildChangelog(rawVersions) {
  return rawVersions
    .map(({ version, date, body, commits }) => {
      const notes = body && body.trim() ? body.trim() : null;
      // A curated tag annotation replaces the auto-generated commit list.
      const sections = notes ? [] : categorize(commits).sections;
      return { version, date, notes, sections };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}
