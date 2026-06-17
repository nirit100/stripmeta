import { describe, it, expect, vi } from 'vitest';
import { pooled, Semaphore } from '../src/lib/util/concurrency';

const tick = () => new Promise<void>(r => setTimeout(r, 0));

// ─── pooled ───────────────────────────────────────────────────────────────────

describe('pooled', () => {
  it('returns results in input order regardless of completion order', async () => {
    const delays = [30, 0, 10, 20, 5];
    const out = await pooled(delays, 2, d =>
      new Promise<number>(res => setTimeout(() => res(d), d)));
    expect(out).toEqual(delays);
  });

  it('maps every item through fn', async () => {
    const out = await pooled([1, 2, 3, 4], 3, async n => n * 2);
    expect(out).toEqual([2, 4, 6, 8]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await pooled(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('processes all items even when limit exceeds item count', async () => {
    const fn = vi.fn(async (n: number) => n);
    const out = await pooled([1, 2], 10, fn);
    expect(out).toEqual([1, 2]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array for empty input without invoking fn', async () => {
    const fn = vi.fn(async (n: number) => n);
    expect(await pooled([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ─── Semaphore ──────────────────────────────────────────────────────────────

describe('Semaphore', () => {
  it('grants permits immediately while slots remain', async () => {
    const sem = new Semaphore(2);
    let granted = 0;
    await sem.acquire(); granted++;
    await sem.acquire(); granted++;
    expect(granted).toBe(2);
  });

  it('blocks once permits are exhausted and resumes on release', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resumed = false;
    const pending = sem.acquire().then(() => { resumed = true; });

    await tick();
    expect(resumed).toBe(false); // still blocked — no permit available

    sem.release();
    await pending;
    expect(resumed).toBe(true);
  });

  it('hands permits to waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const a = sem.acquire().then(() => order.push(1));
    const b = sem.acquire().then(() => order.push(2));

    sem.release();
    await a;
    sem.release();
    await b;
    expect(order).toEqual([1, 2]);
  });

  it('returns the permit to the pool when no one is waiting', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    sem.release();
    // Pool replenished — the next acquire resolves immediately.
    await expect(Promise.race([sem.acquire(), Promise.reject(new Error('blocked'))]))
      .resolves.toBeUndefined();
  });
});
