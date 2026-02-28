import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { synchronizeStreams } from './stream.utils';

type TradingPairCandle = { symbol: TradingPair; candle: Candle };

describe('synchronizeStreams', () => {
  const createStream = (data: Partial<TradingPairCandle>[]) => Readable.from(data);

  it('should merge two streams in chronological order and group by timestamp', async () => {
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
    const result: { t: number; candles: { s: string; t: number }[] }[] = [];

    for await (const bucket of merged) {
      // bucket is CandleBucket (Map<TradingPair, Candle>)
      const candles: { s: string; t: number }[] = [];
      let time = 0;
      for (const [symbol, candle] of bucket.entries()) {
        candles.push({ s: symbol, t: candle.start });
        time = candle.start;
      }
      // Sort candles by symbol to ensure deterministic order for comparison
      candles.sort((a, b) => a.s.localeCompare(b.s));
      result.push({ t: time, candles });
    }

    // Expectation:
    // T=100: BTC, ETH
    // T=200: ETH
    // T=300: BTC, ETH
    expect(result).toEqual([
      {
        t: 100,
        candles: [
          { s: 'BTC/USDT', t: 100 },
          { s: 'ETH/USDT', t: 100 },
        ],
      },
      {
        t: 200,
        candles: [{ s: 'ETH/USDT', t: 200 }],
      },
      {
        t: 300,
        candles: [
          { s: 'BTC/USDT', t: 300 },
          { s: 'ETH/USDT', t: 300 },
        ],
      },
    ]);
  });

  it('should handle streams ending at different times', async () => {
    const streamA = createStream([{ symbol: 'BTC/USDT', candle: { start: 10 } as any }]);
    const streamB = createStream([
      { symbol: 'ETH/USDT', candle: { start: 10 } as any },
      { symbol: 'ETH/USDT', candle: { start: 20 } as any },
    ]);

    const merged = synchronizeStreams([streamA, streamB]);
    const result: { t: number; candles: { s: string; t: number }[] }[] = [];

    for await (const bucket of merged) {
      const candles: { s: string; t: number }[] = [];
      let time = 0;
      for (const [symbol, candle] of bucket.entries()) {
        candles.push({ s: symbol, t: candle.start });
        time = candle.start;
      }
      candles.sort((a, b) => a.s.localeCompare(b.s));
      result.push({ t: time, candles });
    }

    expect(result).toEqual([
      {
        t: 10,
        candles: [
          { s: 'BTC/USDT', t: 10 },
          { s: 'ETH/USDT', t: 10 },
        ],
      },
      {
        t: 20,
        candles: [{ s: 'ETH/USDT', t: 20 }],
      },
    ]);
  });
});
