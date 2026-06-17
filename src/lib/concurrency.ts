// Concurrency primitives shared across the app.
//
// Two distinct shapes are needed and intentionally kept separate:
//   • `pooled`    — process a *known* array with bounded concurrency, results
//                   returned in input order. Used for classify/strip batches.
//   • `Semaphore` — gate an *open-ended* stream of independently-arriving async
//                   tasks. Used for metadata reads, which fire per file card as
//                   cards render (including lazily, when a directory expands),
//                   so there is no fixed array to hand to `pooled`.

/** Runs at most `limit` calls of `fn` concurrently, preserving result order. */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    let next;
    while ((next = queue.shift())) results[next.i] = await fn(next.item);
  }));
  return results;
}

/**
 * A counting semaphore. `acquire()` resolves immediately while permits remain,
 * otherwise queues FIFO until a `release()` hands a permit over. Releasing with
 * no waiter waiting returns the permit to the pool.
 */
export class Semaphore {
  private slots: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.slots = permits;
  }

  acquire(): Promise<void> {
    return this.slots > 0
      ? (this.slots--, Promise.resolve())
      : new Promise<void>(resolve => this.waiters.push(resolve));
  }

  release(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
    else this.slots++;
  }
}
