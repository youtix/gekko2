/**
 * A simple async mutex for serializing access to critical sections.
 * This prevents race conditions when multiple async operations try to
 * access shared state concurrently.
 */
export class AsyncMutex {
  private queue: Array<(release: () => void) => void> = [];
  private locked = false;

  /**
   * Acquires the lock. If the lock is already held, waits until it's released.
   * Returns a function that must be called to release the lock.
   */
  async acquire(): Promise<() => void> {
    return new Promise<() => void>(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve(this.release.bind(this));
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Pass the release function to the next waiter
      next(this.release.bind(this));
    } else {
      this.locked = false;
    }
  }

  /**
   * Runs an async function while holding the lock.
   * The lock is released automatically when the function completes or throws.
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
