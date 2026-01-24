import { CandleEvent } from '@models/event.types';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { synchronizeStreams } from './stream.utils';

describe('synchronizeStreams', () => {
  const createStream = (data: Partial<CandleEvent>[]) => Readable.from(data);

  it('should merge two streams in chronological order', async () => {
    const streamA = createStream([
      { symbol: 'BTC/USDT', candle: { start: 100 } as any },
      { symbol: 'BTC/USDT', candle: { start: 300 } as any },
    ]);
    const streamB = createStream([
      { symbol: 'ETH/USDT', candle: { start: 100 } as any },
      { symbol: 'ETH/USDT', candle: { start: 200 } as any },
      { symbol: 'ETH/USDT', candle: { start: 300 } as any },
    ]);

    const merged = synchronizeStreams([streamA, streamB]);
    const result: any[] = [];

    for await (const chunk of merged) {
      result.push({ s: chunk.symbol, t: chunk.candle.start });
    }

    expect(result).toEqual([
      { s: 'BTC/USDT', t: 100 },
      { s: 'ETH/USDT', t: 100 },
      { s: 'ETH/USDT', t: 200 },
      { s: 'BTC/USDT', t: 300 },
      { s: 'ETH/USDT', t: 300 },
    ]);
  });

  it('should handle streams ending at different times', async () => {
    const streamA = createStream([{ symbol: 'BTC/USDT', candle: { start: 10 } as any }]);
    const streamB = createStream([
      { symbol: 'ETH/USDT', candle: { start: 10 } as any },
      { symbol: 'ETH/USDT', candle: { start: 20 } as any },
    ]);

    const merged = synchronizeStreams([streamA, streamB]);
    const result: any[] = [];
    for await (const chunk of merged) {
      result.push({ s: chunk.symbol, t: chunk.candle.start });
    }
    expect(result).toEqual([
      { s: 'BTC/USDT', t: 10 },
      { s: 'ETH/USDT', t: 10 },
      { s: 'ETH/USDT', t: 20 },
    ]);
  });
});
