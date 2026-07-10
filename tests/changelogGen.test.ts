import { describe, it, expect } from 'vitest';
import { parseSubject, categorize, buildChangelog, regroupByScope } from '../scripts/lib/changelog.mjs';

const c = (subject: string, children: string[] = []) => ({ subject, children });
const i = (text: string, scope: string | null) => ({ text, details: [], scope });

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

describe('regroupByScope', () => {
  it('leaves already-adjacent, already-chronological items alone', () => {
    const items = [i('newer', 'foo'), i('older', 'bar')];
    expect(regroupByScope(items)).toEqual([
      { text: 'newer', details: [] },
      { text: 'older', details: [] },
    ]);
  });

  it('reverses a same-scope run to chronological (oldest first) order', () => {
    const items = [i('newest: follow-up', 'foo'), i('oldest: original', 'foo')];
    expect(regroupByScope(items).map(x => x.text)).toEqual(['oldest: original', 'newest: follow-up']);
  });

  it('pulls a same-scope item forward across an intervening different scope', () => {
    const items = [i('foo newest', 'foo'), i('bar', 'bar'), i('foo oldest', 'foo')];
    expect(regroupByScope(items).map(x => x.text)).toEqual(['foo oldest', 'foo newest', 'bar']);
  });

  it('treats null scope as its own group, distinct from any named scope', () => {
    const items = [i('scopeless newest', null), i('foo', 'foo'), i('scopeless oldest', null)];
    expect(regroupByScope(items).map(x => x.text)).toEqual(['scopeless oldest', 'scopeless newest', 'foo']);
  });

  it('a group\'s slot is set by its first (newest) occurrence, keeping unrelated scopes newest-first overall', () => {
    const items = [i('bar newest', 'bar'), i('foo newest', 'foo'), i('bar oldest', 'bar'), i('foo oldest', 'foo')];
    // bar seen first -> bar's run (chronological) comes first, then foo's run.
    expect(regroupByScope(items).map(x => x.text)).toEqual(['bar oldest', 'bar newest', 'foo oldest', 'foo newest']);
  });

  it('strips the internal scope field from the returned items', () => {
    expect(regroupByScope([i('a', 'foo')])).toEqual([{ text: 'a', details: [] }]);
  });

  it('is a no-op on an empty list', () => {
    expect(regroupByScope([])).toEqual([]);
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

  it('pulls same-scope fixes together and orders that run oldest first', () => {
    const { sections } = categorize([
      c('fix(foo): found a related bug and fixed that too'), // newest
      c('fix(foo): fixed a thing'),                          // oldest
    ]);
    expect(sections).toEqual([
      { title: 'Fixes', items: [
        { text: 'fixed a thing', details: [] },
        { text: 'found a related bug and fixed that too', details: [] },
      ] },
    ]);
  });

  it('pulls a same-scope commit forward even when a different scope sits between them', () => {
    const { sections } = categorize([
      c('fix(foo): again, something in foo'), // newest
      c('fix(bar): an unrelated fix'),
      c('fix(foo): first fix in foo'),         // oldest
    ]);
    expect(sections).toEqual([
      { title: 'Fixes', items: [
        { text: 'first fix in foo', details: [] },
        { text: 'again, something in foo', details: [] },
        { text: 'an unrelated fix', details: [] },
      ] },
    ]);
  });

  it('groups scope-less commits ("fix: …") together the same way', () => {
    const { sections } = categorize([
      c('fix: second scope-less fix'), // newest
      c('fix(foo): unrelated'),
      c('fix: first scope-less fix'),  // oldest
    ]);
    expect(sections).toEqual([
      { title: 'Fixes', items: [
        { text: 'first scope-less fix', details: [] },
        { text: 'second scope-less fix', details: [] },
        { text: 'unrelated', details: [] },
      ] },
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
