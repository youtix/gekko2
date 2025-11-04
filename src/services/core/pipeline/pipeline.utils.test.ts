import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@services/storage/sqlite.storage', () => ({
  SQLiteStorage: class {
    close() {}
  },
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({
      timeframe: '1m',
      warmup: { candleCount: 0, tickrate: 1000 },
    })),
  },
}));

describe('pipeline utils', () => {
  it('concats multiple streams sequentially', async () => {
    const { mergeSequentialStreams } = await import('./pipeline.utils');
    const s1 = Readable.from([1, 2]);
    const s2 = Readable.from([3]);
    const merged = mergeSequentialStreams(s1, s2);
    const result: number[] = [];
    for await (const c of merged) result.push(c as number);
    expect(result).toEqual([1, 2, 3]);
  });
});
