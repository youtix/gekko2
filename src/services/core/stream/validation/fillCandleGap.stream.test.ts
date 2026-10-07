import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { debug, warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FillCandleGapStream } from './fillCandleGap.stream';

// Mocks
vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@utils/candle/candle.utils', () => ({
  createEmptyCandle: vi.fn((lastCandle: Candle) => ({
    ...lastCandle,
    start: lastCandle.start + 60000,
    volume: 0,
    open: lastCandle.close,
    high: lastCandle.close,
    low: lastCandle.close,
  })),
}));

describe('FillCandleGapStream', () => {
  let stream: FillCandleGapStream;
  const eth: TradingPair = 'ETH/USDT';
  const btc: TradingPair = 'BTC/USDT';
  const pairs = [eth, btc];

  const start = 1000000;

  const ethCandle: Candle = { start, open: 100, high: 110, low: 90, close: 105, volume: 1000 };
  const btcCandle: Candle = { start, open: 20000, high: 21000, low: 19000, close: 20500, volume: 50 };

  beforeEach(() => {
    stream = new FillCandleGapStream(pairs);
  });

  const createBucket = (timestamp?: number, candles: { pair: TradingPair; candle: Candle }[] = []): CandleBucket => {
    const bucket: CandleBucket = new Map();
    candles.forEach(({ pair, candle }) => {
      // Pair is a string, so use it directly as key
      bucket.set(pair, timestamp ? { ...candle, start: timestamp } : candle);
    });
    return bucket;
  };

  it('Complete Stream: should pass through complete buckets without modification', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket1 = createBucket(start, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);
    const bucket2 = createBucket(start + 60000, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);

    stream.write(bucket1);
    stream.write(bucket2);

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenNthCalledWith(1, bucket1);
    expect(dataFn).toHaveBeenNthCalledWith(2, bucket2);
    expect(createEmptyCandle).not.toHaveBeenCalled();
  });

  it('Total Gap: should fill missing minutes for all assets', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T2 (Gap at T1)
    const bucketT2 = createBucket(start + 120000, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);
    stream.write(bucketT2);

    expect(dataFn).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalled();

    // Check T1 (synthetic)
    const filledBucket = dataFn.mock.calls[1][0] as CandleBucket;
    expect(filledBucket.size).toBe(2);
    expect(filledBucket.get(eth)).toMatchObject({ start: start + 60000, volume: 0 });
    expect(filledBucket.get(btc)).toMatchObject({ start: start + 60000, volume: 0 });

    // Check T2
    expect(dataFn).toHaveBeenLastCalledWith(bucketT2);
  });

  it('Partial Gap (Start): should fill missing asset in initial bucket', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Initial bucket only has ETH
    const initialBucket = createBucket(start, [{ pair: eth, candle: ethCandle }]);
    stream.write(initialBucket);

    expect(dataFn).toHaveBeenCalledTimes(1);
    const emittedBucket = dataFn.mock.calls[0][0] as CandleBucket;

    expect(emittedBucket.size).toBe(1);
    expect(emittedBucket.get(eth)).toBeDefined();
    // note: btc cannot be filled as initialization has no prior state
    expect(emittedBucket.get(btc)).toBeUndefined();
  });

  it('Partial Gap (Mid): should fill missing asset in a subsequent bucket', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both assets
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: Only ETH
    const partialBucket = createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]);
    stream.write(partialBucket);

    expect(dataFn).toHaveBeenCalledTimes(2);
    const emittedBucket = dataFn.mock.calls[1][0] as CandleBucket;

    expect(emittedBucket.size).toBe(2);
    expect(emittedBucket.get(eth)).toBeDefined(); // Real
    expect(emittedBucket.get(btc))?.toBeDefined(); // Filled
    expect(emittedBucket.get(btc)!.volume).toBe(0);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining(`Partial gap detected for ${btc}`));
  });

  it('Partial Gap (Intermittent): should handle assets dropping in and out', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: BTC missing
    stream.write(createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]));

    // T2: ETH missing
    stream.write(createBucket(start + 120000, [{ pair: btc, candle: btcCandle }]));

    // T3: Both present
    stream.write(
      createBucket(start + 180000, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    expect(dataFn).toHaveBeenCalledTimes(4);

    // T1 check
    expect(dataFn.mock.calls[1][0].get(btc)?.volume).toBe(0);

    // T2 check
    expect(dataFn.mock.calls[2][0].get(eth)?.volume).toBe(0);
    expect(dataFn.mock.calls[2][0].get(btc)?.volume).toBe(50); // Real data
  });

  it('Cascading Gaps: Partial gap followed by Total gap', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: BTC missing (Partial)
    stream.write(createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]));

    // T3: Both present (Total Gap at T2 of 1 min)
    stream.write(
      createBucket(start + 180000, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // Events:
    // 1. T0 (Full)
    // 2. T1 (ETH real, BTC filled)
    // 3. T2 (Synthetic fill for BOTH)
    // 4. T3 (Full)
    expect(dataFn).toHaveBeenCalledTimes(4);

    // Check T2 (Index 2)
    const t2Bucket = dataFn.mock.calls[2][0] as CandleBucket;
    expect(t2Bucket.size).toBe(2);
    expect(t2Bucket.get(eth)?.volume).toBe(0);
    expect(t2Bucket.get(btc)?.volume).toBe(0);
  });

  describe('a pair that has had no candle yet', () => {
    const at = (minutes: number) => start + minutes * 60000;
    const ethOnly = (minutes: number) => createBucket(at(minutes), [{ pair: eth, candle: ethCandle }]);
    const both = (minutes: number) =>
      createBucket(at(minutes), [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]);

    // Writes the buckets into a gap filler built with the option, and returns the buckets it lets out
    const fill = (completeBucketsOnly: boolean, ...buckets: CandleBucket[]) => {
      const gapFiller = new FillCandleGapStream(pairs, { completeBucketsOnly });
      const emitted: CandleBucket[] = [];
      gapFiller.on('data', bucket => emitted.push(bucket));
      for (const bucket of buckets) gapFiller.write(bucket);
      return emitted;
    };

    it.each`
      completeBucketsOnly | emittedPairs
      ${false}            | ${[[eth]]}
      ${true}             | ${[]}
    `(
      'should let out $emittedPairs from a first bucket lacking it, with completeBucketsOnly $completeBucketsOnly',
      ({ completeBucketsOnly, emittedPairs }) => {
        expect(fill(completeBucketsOnly, ethOnly(0)).map(bucket => [...bucket.keys()])).toEqual(emittedPairs);
      },
    );

    it('should let the first complete bucket out first, without filling the minutes dropped before it', () => {
      const firstComplete = both(2);
      expect(fill(true, ethOnly(0), firstComplete)).toEqual([firstComplete]);
    });

    it('should fill it once it has had a candle, with completeBucketsOnly', () => {
      const [, filled] = fill(true, both(0), ethOnly(1));
      expect(filled.get(btc)).toMatchObject({ start: at(1), volume: 0 });
    });

    describe('the logs of the buckets dropped', () => {
      const sol: TradingPair = 'SOL/USDT';
      const candles: Record<TradingPair, Candle> = { [eth]: ethCandle, [btc]: btcCandle, [sol]: { ...ethCandle, close: 150 } };
      const iso = (minutes: number) => new Date(at(minutes)).toISOString();
      // A bucket at the given minute, with a candle of each pair given
      const bucketOf = (minutes: number, ...present: TradingPair[]) =>
        createBucket(
          at(minutes),
          present.map(pair => ({ pair, candle: candles[pair] })),
        );

      // Writes the buckets into a gap filler of the watched pairs that lets complete buckets only out
      const write = (watched: TradingPair[], ...buckets: CandleBucket[]) => {
        const gapFiller = new FillCandleGapStream(watched, { completeBucketsOnly: true });
        for (const bucket of buckets) gapFiller.write(bucket);
      };

      it('should warn of the first drop only, saying that the buckets are dropped until every pair has had a candle', () => {
        write(pairs, ethOnly(0), ethOnly(1), ethOnly(2));
        expect(vi.mocked(warning).mock.calls).toEqual([
          [
            'stream',
            `No ${btc} candle at ${iso(0)}, nor an earlier one to fill it with: the buckets are dropped until every pair has had a candle`,
          ],
        ]);
      });

      it('should log the next drops at debug level, with the pairs and the minute', () => {
        write([btc, eth, sol], bucketOf(0, btc, sol), bucketOf(1, btc), bucketOf(2, btc));
        expect(vi.mocked(debug).mock.calls).toEqual([
          ['stream', `No ${eth}, ${sol} candle at ${iso(1)}, nor an earlier one to fill it with: bucket dropped`],
          ['stream', `No ${eth}, ${sol} candle at ${iso(2)}, nor an earlier one to fill it with: bucket dropped`],
        ]);
      });

      it.each`
        drops                      | watched            | buckets                                                                  | summary
        ${'one'}                   | ${[eth, btc]}      | ${[ethOnly(0), both(1)]}                                                 | ${`1 bucket dropped from ${iso(0)} to ${iso(0)}, for want of a candle of ${btc}: the stream starts at ${iso(1)}`}
        ${'three'}                 | ${[eth, btc]}      | ${[ethOnly(0), ethOnly(1), ethOnly(2), both(3)]}                         | ${`3 buckets dropped from ${iso(0)} to ${iso(2)}, for want of a candle of ${btc}: the stream starts at ${iso(3)}`}
        ${'two of changing pairs'} | ${[btc, eth, sol]} | ${[bucketOf(0, btc, sol), bucketOf(1, btc), bucketOf(2, btc, eth, sol)]} | ${`2 buckets dropped from ${iso(0)} to ${iso(1)}, for want of a candle of ${eth}, ${sol}: the stream starts at ${iso(2)}`}
      `('should sum $drops drop(s) up in a warning when the stream starts', ({ watched, buckets, summary }) => {
        write(watched, ...buckets);
        expect(vi.mocked(warning).mock.lastCall).toEqual(['stream', summary]);
      });

      // The first of the three drops and the summary
      it('should sum the drops up once', () => {
        write(pairs, ethOnly(0), ethOnly(1), ethOnly(2), both(3), both(4));
        expect(warning).toHaveBeenCalledTimes(2);
      });

      it('should not warn when no bucket is dropped', () => {
        write(pairs, both(0), both(1));
        expect(warning).not.toHaveBeenCalled();
      });
    });
  });
});
