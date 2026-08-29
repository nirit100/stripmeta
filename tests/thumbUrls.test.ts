import { describe, it, expect, beforeEach } from 'vitest';
import { ThumbUrls } from '../src/lib/state/thumbUrls';
import type { ObjectUrlFactory } from '../src/lib/state/thumbUrls';

class FakeUrls implements ObjectUrlFactory {
  created: string[] = [];
  revoked: string[] = [];
  private n = 0;

  createObjectURL(): string {
    const url = `blob:${++this.n}`;
    this.created.push(url);
    return url;
  }

  revokeObjectURL(url: string): void {
    this.revoked.push(url);
  }

  /** URLs handed out but never revoked — the leak the class exists to prevent. */
  get live(): string[] {
    return this.created.filter(u => !this.revoked.includes(u));
  }
}

function makeFile(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

let fake: FakeUrls;
let urls: ThumbUrls;

beforeEach(() => {
  fake = new FakeUrls();
  urls = new ThumbUrls(fake);
});

describe('create', () => {
  it('hands out a URL and remembers it', () => {
    const file = makeFile();
    const url = urls.create(file);
    expect(urls.get(file)).toBe(url);
    expect(fake.revoked).toEqual([]);
  });

  it('revokes the previous URL when the same file is re-rendered', () => {
    const file = makeFile();
    const first = urls.create(file);
    const second = urls.create(file);

    expect(fake.revoked).toEqual([first]);
    expect(urls.get(file)).toBe(second);
    expect(fake.live).toEqual([second]);
  });

  it('leaves nothing stranded across many re-renders of the same file', () => {
    const file = makeFile();
    for (let i = 0; i < 10; i++) urls.create(file);

    expect(fake.created).toHaveLength(10);
    expect(fake.live).toHaveLength(1);
    expect(urls.size).toBe(1);
  });

  it('keeps URLs for different files independent', () => {
    const a = makeFile('a.jpg');
    const b = makeFile('b.jpg');
    const urlA = urls.create(a);
    const urlB = urls.create(b);

    expect(urlA).not.toBe(urlB);
    expect(fake.revoked).toEqual([]);
    expect(urls.size).toBe(2);
  });
});

describe('release', () => {
  it('revokes and forgets the URL', () => {
    const file = makeFile();
    const url = urls.create(file);
    urls.release(file);

    expect(fake.revoked).toEqual([url]);
    expect(urls.get(file)).toBeUndefined();
    expect(urls.size).toBe(0);
  });

  it('is a no-op for a file that has no URL', () => {
    urls.release(makeFile());
    expect(fake.revoked).toEqual([]);
  });

  it('does not revoke twice when called repeatedly', () => {
    const file = makeFile();
    urls.create(file);
    urls.release(file);
    urls.release(file);

    expect(fake.revoked).toHaveLength(1);
  });
});

describe('releaseAll', () => {
  it('revokes every held URL exactly once', () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')];
    const created = files.map(f => urls.create(f));
    urls.releaseAll();

    expect(fake.revoked.sort()).toEqual(created.sort());
    expect(urls.size).toBe(0);
    expect(fake.live).toEqual([]);
  });

  it('does not re-revoke URLs already released individually', () => {
    const a = makeFile('a.jpg');
    const b = makeFile('b.jpg');
    urls.create(a);
    urls.create(b);
    urls.release(a);
    urls.releaseAll();

    expect(fake.revoked).toHaveLength(2);
  });
});
