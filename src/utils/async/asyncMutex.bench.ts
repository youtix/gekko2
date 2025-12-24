import { bench, describe } from 'vitest';
import { AsyncMutex } from './asyncMutex';

describe('AsyncMutex Performance', () => {
  bench('acquire and release (uncontended)', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    release();
  });

  bench('runExclusive with sync fn (uncontended)', async () => {
    const mutex = new AsyncMutex();
    await mutex.runExclusive(() => 42);
  });

  bench('runExclusive with async fn (uncontended)', async () => {
    const mutex = new AsyncMutex();
    await mutex.runExclusive(async () => 42);
  });

  bench('sequential acquire/release (10 operations)', async () => {
    const mutex = new AsyncMutex();
    for (let i = 0; i < 10; i++) {
      const release = await mutex.acquire();
      release();
    }
  });

  bench('concurrent runExclusive (10 contenders)', async () => {
    const mutex = new AsyncMutex();
    await Promise.all(Array.from({ length: 10 }, () => mutex.runExclusive(() => 42)));
  });

  bench('concurrent runExclusive (100 contenders)', async () => {
    const mutex = new AsyncMutex();
    await Promise.all(Array.from({ length: 100 }, () => mutex.runExclusive(() => 42)));
  });
});
