import { describe, expect, it } from 'vitest';
import { AsyncMutex } from './asyncMutex';

describe('AsyncMutex', () => {
  describe('acquire', () => {
    it('should return a release function when lock is available', async () => {
      const mutex = new AsyncMutex();

      const release = await mutex.acquire();

      expect(typeof release).toBe('function');
    });

    it('should acquire lock immediately when not locked', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      events.push('before-acquire');
      await mutex.acquire();
      events.push('after-acquire');

      expect(events).toEqual(['before-acquire', 'after-acquire']);
    });

    it('should queue callers when lock is already held', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      const release1 = await mutex.acquire();
      events.push('acquired-1');

      // Start a second acquire that should wait
      const acquire2Promise = mutex.acquire().then(release => {
        events.push('acquired-2');
        return release;
      });

      // Give the event loop a chance to process
      await Promise.resolve();
      expect(events).toEqual(['acquired-1']);

      // Release first lock
      release1();
      await acquire2Promise;

      expect(events).toEqual(['acquired-1', 'acquired-2']);
    });

    it('should process waiting callers in FIFO order', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      const release1 = await mutex.acquire();
      events.push('acquired-1');

      // Queue multiple waiters
      const acquire2Promise = mutex.acquire().then(release => {
        events.push('acquired-2');
        return release;
      });
      const acquire3Promise = mutex.acquire().then(release => {
        events.push('acquired-3');
        return release;
      });

      // Release first, should go to second
      release1();
      const release2 = await acquire2Promise;

      expect(events).toEqual(['acquired-1', 'acquired-2']);

      // Release second, should go to third
      release2();
      await acquire3Promise;

      expect(events).toEqual(['acquired-1', 'acquired-2', 'acquired-3']);
    });

    it('should allow re-acquiring lock after release when no waiters', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      const release1 = await mutex.acquire();
      events.push('acquired-1');
      release1();

      const release2 = await mutex.acquire();
      events.push('acquired-2');
      release2();

      expect(events).toEqual(['acquired-1', 'acquired-2']);
    });
  });

  describe('runExclusive', () => {
    it('should return the value from the provided function', async () => {
      const mutex = new AsyncMutex();

      const result = await mutex.runExclusive(() => 42);

      expect(result).toBe(42);
    });

    it('should return the value from an async function', async () => {
      const mutex = new AsyncMutex();

      const result = await mutex.runExclusive(async () => {
        await Promise.resolve();
        return 'async-result';
      });

      expect(result).toBe('async-result');
    });

    it('should release the lock after sync function completes', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      await mutex.runExclusive(() => {
        events.push('first');
      });

      await mutex.runExclusive(() => {
        events.push('second');
      });

      expect(events).toEqual(['first', 'second']);
    });

    it('should release the lock after async function completes', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      await mutex.runExclusive(async () => {
        await Promise.resolve();
        events.push('first');
      });

      await mutex.runExclusive(async () => {
        await Promise.resolve();
        events.push('second');
      });

      expect(events).toEqual(['first', 'second']);
    });

    it('should release the lock when function throws synchronously', async () => {
      const mutex = new AsyncMutex();
      const testError = new Error('sync-error');

      await expect(
        mutex.runExclusive(() => {
          throw testError;
        }),
      ).rejects.toThrow(testError);

      // Lock should be released, so next acquire should work immediately
      const acquired = await Promise.race([
        mutex.acquire().then(() => 'acquired'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 10)),
      ]);

      expect(acquired).toBe('acquired');
    });

    it('should release the lock when async function rejects', async () => {
      const mutex = new AsyncMutex();
      const testError = new Error('async-error');

      await expect(
        mutex.runExclusive(async () => {
          await Promise.resolve();
          throw testError;
        }),
      ).rejects.toThrow(testError);

      // Lock should be released, so next acquire should work immediately
      const acquired = await Promise.race([
        mutex.acquire().then(() => 'acquired'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 10)),
      ]);

      expect(acquired).toBe('acquired');
    });

    it('should serialize concurrent runExclusive calls', async () => {
      const mutex = new AsyncMutex();
      const events: string[] = [];

      const task = (id: string, delay: number) =>
        mutex.runExclusive(async () => {
          events.push(`start-${id}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          events.push(`end-${id}`);
          return id;
        });

      // Start all tasks concurrently
      const results = await Promise.all([task('A', 20), task('B', 10), task('C', 5)]);

      // Tasks should complete in order A, B, C despite different delays
      expect(events).toEqual(['start-A', 'end-A', 'start-B', 'end-B', 'start-C', 'end-C']);
      expect(results).toEqual(['A', 'B', 'C']);
    });

    it('should prevent race conditions on shared state', async () => {
      const mutex = new AsyncMutex();
      let counter = 0;

      const increment = () =>
        mutex.runExclusive(async () => {
          const current = counter;
          await Promise.resolve(); // Simulate async operation
          counter = current + 1;
        });

      // Without mutex, these would race and result in counter = 1
      await Promise.all([increment(), increment(), increment()]);

      expect(counter).toBe(3);
    });
  });
});
