import { describe, it, expect } from 'vitest';
import { parseSubject, categorize, buildChangelog } from '../scripts/lib/changelog.mjs';

const c = (subject: string, children: string[] = []) => ({ subject, children });

describe('parseSubject', () => {
  it('parses type, scope and description', () => {
    expect(parseSubject('feat(viewer): open from thumbnail')).toEqual({
      type: 'feat', scope: 'viewer', description: 'open from thumbnail',
    });
  });

  it('derives a change from a PR-merge branch name', () => {
    expect(parseSubject('Merge pull request #130 from nirit100/feat/full-screen-photo-preview')).toEqual({
      type: 'feat', scope: null, description: 'full screen photo preview',
    });
  });

  it('returns null for non-conventional and prefixless-branch merges', () => {
    expect(parseSubject('just some words')).toBeNull();
    expect(parseSubject('Merge pull request #1 from nirit100/hotfix')).toBeNull();
  });
});

describe('categorize', () => {
  it('groups feat/fix/perf and reports drops with reasons', () => {
    const { sections, dropped } = categorize([
      c('feat: add viewer'),
      c('fix: handle empty file'),
      c('chore: bump to v1.2.3'),
      c('random unparseable subject'),
    ]);

    expect(sections).toEqual([
      { title: 'Features', items: [{ text: 'add viewer', details: [] }] },
      { title: 'Fixes', items: [{ text: 'handle empty file', details: [] }] },
    ]);
    expect(dropped).toEqual([
      { subject: 'chore: bump to v1.2.3', reason: 'chore' },
      { subject: 'random unparseable subject', reason: 'non-conventional' },
    ]);
  });

  it('nests a merged PR\'s user-facing branch commits under its headline', () => {
    const { sections } = categorize([
      c('Merge pull request #130 from nirit100/feat/photo-viewer', [
        'feat: open from thumbnail',
        'feat: swipe carousel',
        'refactor: tidy internals',
      ]),
    ]);
    expect(sections).toEqual([
      { title: 'Features', items: [
        { text: 'photo viewer', details: ['open from thumbnail', 'swipe carousel'] },
      ] },
    ]);
  });

  it('surfaces a feature hidden inside a non-user-facing branch', () => {
    const { sections } = categorize([
      c('Merge pull request #5 from nirit100/refactor/the-grand-refactor', [
        'refactor: move things',
        'feat: a rescued feature',
      ]),
    ]);
    expect(sections).toEqual([
      { title: 'Features', items: [{ text: 'a rescued feature', details: [] }] },
    ]);
  });
});

describe('buildChangelog', () => {
  it('sorts versions newest-first', () => {
    const out = buildChangelog([
      { version: '0.4.0', date: '2026-01-01', commits: [c('feat: a')] },
      { version: '0.10.0', date: '2026-03-01', commits: [c('feat: b')] },
      { version: '0.5.0', date: '2026-02-01', commits: [c('feat: c')] },
    ]);
    expect(out.map(e => e.version)).toEqual(['0.10.0', '0.5.0', '0.4.0']);
  });

  it('lets an annotated-tag body override the commit list', () => {
    const [entry] = buildChangelog([
      { version: '1.0.0', date: '2026-01-01', body: 'Hand-written notes.', commits: [c('feat: ignored')] },
    ]);
    expect(entry.notes).toBe('Hand-written notes.');
    expect(entry.sections).toEqual([]);
  });
});
