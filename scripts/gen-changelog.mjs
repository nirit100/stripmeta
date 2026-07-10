#!/usr/bin/env node
// Generates src/data/changelog.json from git tags + history.
//
// Runs where a full clone exists (your machine, via `npm run bump` or
// `npm run gen-changelog`) — never at deploy time — so Cloudflare's shallow
// clone is irrelevant and the committed JSON is the single source of truth.

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { buildChangelog, categorize, compareVersions } from './lib/changelog.mjs';

const OUT_PATH = new URL('../src/data/changelog.json', import.meta.url).pathname;
// A copy served at a stable URL (/changelog.json) so the running app can fetch
// the newest deployed changelog — e.g. the update toast previewing an incoming
// version's notes before the update is applied.
const PUBLIC_OUT_PATH = new URL('../public/changelog.json', import.meta.url).pathname;

// argv array → no shell, so format strings like %(contents:body) need no escaping.
function git(...args) {
  return execFileSync('git', args, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

/** All `vX.Y.Z` tags, oldest first. */
function listVersionTags() {
  return git('tag', '--sort=v:refname', '--list', 'v*')
    .split('\n')
    .map(t => t.trim())
    .filter(t => /^v\d+\.\d+\.\d+$/.test(t));
}

/**
 * Mainline commits in `range`, newest first. Walks first-parent only so branch
 * internals aren't double-counted; for each PR-merge it pulls the branch's own
 * commit subjects as `children`.
 * @returns {{ subject: string, children: string[] }[]}
 */
function commitsIn(range) {
  const SEP = '\x1f'; // unit separator — absent from commit metadata (NUL is rejected by execFileSync)
  const lines = git('log', '--first-parent', `--format=%H${SEP}%P${SEP}%s`, range)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  return lines.map(line => {
    const [, parents, subject] = line.split(SEP);
    const parentHashes = parents.split(' ').filter(Boolean);
    if (parentHashes.length < 2) return { subject, children: [] };
    // Merge: branch commits are reachable from the second parent but not the first.
    const children = git('log', '--no-merges', '--format=%s', `${parentHashes[0]}..${parentHashes[1]}`)
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    return { subject, children };
  });
}

const bare = tag => tag.replace(/^v/, '');

/**
 * Print a human-readable audit of one release to the terminal so the programmer
 * can eyeball it before the tag is cut: every commit either lands in a category
 * or is shown as filtered-out with the reason.
 */
function printReleaseDetail(rawVersion, label) {
  console.log(`\n${label} v${rawVersion.version}`);
  if (rawVersion.body && rawVersion.body.trim()) {
    console.log('  (curated release notes from tag annotation — commits not categorized)');
    return;
  }
  const { sections, dropped } = categorize(rawVersion.commits);
  if (!sections.length && !dropped.length) {
    console.log('  (no commits since the previous tag)');
  }
  for (const sec of sections) {
    console.log(`  ${sec.title} (${sec.items.length})`);
    for (const item of sec.items) {
      console.log(`    + ${item.text}`);
      for (const detail of item.details) console.log(`        · ${detail}`);
    }
  }
  if (dropped.length) {
    console.log(`  Filtered out (${dropped.length})`);
    for (const d of dropped) console.log(`    – ${d.subject}  [${d.reason}]`);
  }
}

/** One-line-per-version overview of the whole changelog. */
function printOverview(raw) {
  console.log('\nAll versions:');
  for (const v of [...raw].sort((a, b) => compareVersions(b.version, a.version))) {
    if (v.body && v.body.trim()) { console.log(`  v${v.version}  curated notes`); continue; }
    const { sections, dropped } = categorize(v.commits);
    const included = sections.reduce((n, s) => n + s.items.length, 0);
    console.log(`  v${v.version}  ${included} included  ${dropped.length} filtered`);
  }
}

/**
 * Render one built changelog entry exactly as the app displays it (see
 * renderEntries in src/scripts/changelog.ts) — version header, then either
 * curated notes, categorized sections with nested details, or the
 * no-user-facing-changes placeholder. `entry.sections` here is the final,
 * already-categorized-and-regrouped data (same-scope commits already pulled
 * together and reordered chronologically by categorize/regroupByScope) —
 * this just formats it for the terminal, it does no ordering of its own.
 * @param {{ version: string, notes: string | null, sections: { title: string, items: { text: string, details: string[] }[] }[] }} entry
 * @returns {string}
 */
function formatPreview(entry) {
  const lines = [`v${entry.version}`, ''];
  if (entry.notes) {
    lines.push(entry.notes);
  } else if (entry.sections.length) {
    for (const sec of entry.sections) {
      lines.push(sec.title.toUpperCase());
      for (const item of sec.items) {
        lines.push(`  • ${item.text}`);
        for (const detail of item.details) lines.push(`      - ${detail}`);
      }
      lines.push('');
    }
    lines.pop(); // drop the trailing blank line after the last section
  } else {
    lines.push('Maintenance and internal improvements.');
  }
  return lines.join('\n');
}

/** Preview of the newest version's entry, as it will actually be displayed. */
function printPreview(entry) {
  console.log(`\n--- Preview: what users will see ---\n\n${formatPreview(entry)}`);
}

/** Preview of every version's entry, newest first. */
function printAllPreviews(changelog) {
  console.log('\n--- Preview: what users will see (all versions) ---');
  for (const entry of changelog) console.log(`\n${formatPreview(entry)}`);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.pendingVersion] bare `x.y.z` being released now but not
 *   yet tagged; its commits are everything since the latest existing tag.
 * @param {boolean} [opts.write=true] write the file (false → just return data).
 * @param {boolean} [opts.summary=true] print a terminal audit of what was
 *   included / filtered out.
 * @param {boolean} [opts.previewAll=false] preview every version's entry
 *   instead of just the newest one.
 * @returns {object[]} the changelog data.
 */
export function generateChangelog({ pendingVersion, write = true, summary = true, previewAll = false } = {}) {
  const tags = listVersionTags();
  const raw = [];

  tags.forEach((tag, i) => {
    const prev = tags[i - 1];
    const range = prev ? `${prev}..${tag}` : tag;
    raw.push({
      version: bare(tag),
      date: git('log', '-1', '--format=%cs', tag).trim(),
      body: git('tag', '-l', tag, '--format=%(contents:body)').trim(),
      commits: commitsIn(range),
    });
  });

  if (pendingVersion) {
    const last = tags[tags.length - 1];
    raw.push({
      version: pendingVersion,
      date: new Date().toISOString().slice(0, 10),
      body: '',
      commits: commitsIn(last ? `${last}..HEAD` : 'HEAD'),
    });
  }

  const changelog = buildChangelog(raw);
  if (write) {
    const json = JSON.stringify(changelog, null, 2) + '\n';
    writeFileSync(OUT_PATH, json);
    writeFileSync(PUBLIC_OUT_PATH, json);
  }

  if (summary) {
    if (pendingVersion) {
      printReleaseDetail(raw[raw.length - 1], 'New release —');
    } else if (raw.length) {
      const newest = [...raw].sort((a, b) => compareVersions(b.version, a.version))[0];
      printReleaseDetail(newest, 'Latest release —');
    }
    printOverview(raw);
    console.log(`\nWrote ${changelog.length} versions to src/data/changelog.json`);

    if (previewAll) printAllPreviews(changelog);
    else if (changelog.length) printPreview(changelog[0]); // buildChangelog sorts newest first
  }

  return changelog;
}

// CLI entrypoint — regenerate from the current tags (no pending version).
// --all / -a previews every version instead of just the newest.
if (import.meta.url === `file://${process.argv[1]}`) {
  const previewAll = process.argv.slice(2).some(a => a === '--all' || a === '-a');
  generateChangelog({ previewAll });
}
