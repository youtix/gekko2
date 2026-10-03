import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { describe, expect, it, vi } from 'vitest';
import { MAX_GAP_FILL_MINUTES } from './fillCandleGap.const';
import { FillCandleGapOptions, FillCandleGapStream } from './fillCandleGap.stream';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));

const ETH: TradingPair = 'ETH/USDT';
const BTC: TradingPair = 'BTC/USDT';
const T0 = Date.UTC(2024, 0, 1);
const at = (minute: number) => T0 + minute * ONE_MINUTE;

const candleAt = (minute: number): Candle => ({ start: at(minute), open: 10, high: 12, low: 9, close: 11 + minute, volume: 100 });

/** A bucket of `minute` holding a real candle of each given pair */
const bucketAt = (minute: number, ...pairs: TradingPair[]): CandleBucket => new Map(pairs.map(pair => [pair, candleAt(minute)]));

/** Describes each emitted bucket as its candles: base asset, minute, and `~` for a synthetic candle, e.g. 'ETH3 BTC3~' */
const describeBuckets = (buckets: CandleBucket[]) =>
  buckets.map(bucket =>
    [...bucket].map(([pair, { start, synthetic }]) => `${pair.split('/')[0]}${(start - T0) / ONE_MINUTE}${synthetic ? '~' : ''}`).join(' '),
  );

/** The messages logged as warnings so far */
const warnings = () => vi.mocked(warning).mock.calls.map(([, message]) => String(message));

const run = async (buckets: CandleBucket[], options?: FillCandleGapOptions, pairs: TradingPair[] = [ETH, BTC]) => {
  const stream = new FillCandleGapStream(pairs, options);
  for (const bucket of buckets) stream.write(bucket);
  stream.end();
  return (await stream.toArray()) as CandleBucket[];
};

const throwUnreadable = () => {
  throw new Error('unreadable');
};

describe('FillCandleGapStream', () => {
  describe('complete buckets', () => {
    it('should push complete consecutive buckets as they are', async () => {
      const buckets = [bucketAt(0, ETH, BTC), bucketAt(1, ETH, BTC)];
      expect(await run(buckets)).toEqual(buckets);
    });

    it('should not warn about complete consecutive buckets', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH, BTC)]);
      expect(warning).not.toHaveBeenCalled();
    });

    it('should push the pairs in the order the stream was built with', async () => {
      const buckets = await run([bucketAt(0, BTC, ETH)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0']);
    });

    it('should leave out a pair the stream was not built with', async () => {
      const buckets = await run([bucketAt(0, ETH, 'LTC/USDT', BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0']);
    });

    it('should drop an empty bucket', async () => {
      const buckets = await run([new Map(), bucketAt(0, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0']);
    });
  });

  describe('leading buckets missing a pair never seen', () => {
    it.each`
      dropIncompleteLeadingBuckets | input                                                               | expected
      ${undefined}                 | ${[bucketAt(0, ETH), bucketAt(1, ETH), bucketAt(2, ETH, BTC)]}      | ${['ETH0', 'ETH1', 'ETH2 BTC2']}
      ${false}                     | ${[bucketAt(0, ETH), bucketAt(1, ETH), bucketAt(2, ETH, BTC)]}      | ${['ETH0', 'ETH1', 'ETH2 BTC2']}
      ${true}                      | ${[bucketAt(0, ETH), bucketAt(1, ETH), bucketAt(2, ETH, BTC)]}      | ${['ETH2 BTC2']}
      ${true}                      | ${[bucketAt(0, ETH), bucketAt(1, BTC), bucketAt(2, ETH, BTC)]}      | ${['ETH1~ BTC1', 'ETH2 BTC2']}
      ${true}                      | ${[bucketAt(0, ETH), bucketAt(1, ETH, BTC), bucketAt(4, ETH, BTC)]} | ${['ETH1 BTC1', 'ETH2~ BTC2~', 'ETH3~ BTC3~', 'ETH4 BTC4']}
    `(
      'should push $expected with dropIncompleteLeadingBuckets $dropIncompleteLeadingBuckets',
      async ({ dropIncompleteLeadingBuckets, input, expected }) => {
        const buckets = await run(input, { dropIncompleteLeadingBuckets });
        expect(describeBuckets(buckets)).toEqual(expected);
      },
    );

    it('should warn once per pair never seen, then once when every pair has had a candle, when dropping leading buckets', async () => {
      await run([bucketAt(0, ETH), bucketAt(1, ETH), bucketAt(2, ETH), bucketAt(3, ETH, BTC)], { dropIncompleteLeadingBuckets: true }, [
        ETH,
        BTC,
        'SOL/USDT',
      ]);
      expect(warnings()).toEqual([
        `No BTC/USDT candle at ${toISOString(at(0))}: dropping the leading buckets until every pair has a candle`,
        `No SOL/USDT candle at ${toISOString(at(0))}: dropping the leading buckets until every pair has a candle`,
      ]);
    });

    it('should tell how many leading minutes were dropped once every pair has had a candle', async () => {
      await run([bucketAt(0, ETH), bucketAt(1, ETH), bucketAt(2, ETH, BTC)], { dropIncompleteLeadingBuckets: true });
      expect(warning).toHaveBeenLastCalledWith(
        'stream',
        `Every pair has had a candle by ${toISOString(at(2))}, the first minute pushed: 2 leading minute(s) dropped, so the warmup will end later than planned`,
      );
    });

    it('should not warn about the leading buckets when they are pushed', async () => {
      await run([bucketAt(0, ETH), bucketAt(1, ETH, BTC)]);
      expect(warning).not.toHaveBeenCalled();
    });
  });

  describe('partial gaps', () => {
    it('should fill a pair missing from a bucket with an empty candle', async () => {
      const buckets = await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH), bucketAt(2, BTC), bucketAt(3, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0', 'ETH1 BTC1~', 'ETH2~ BTC2', 'ETH3 BTC3']);
    });

    it('should fill a pair from its last known candle', async () => {
      const [, filled] = await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH)]);
      expect(filled.get(BTC)).toEqual({ start: at(1), open: 11, high: 11, low: 11, close: 11, volume: 0, synthetic: true });
    });
    it('should warn once when a partial gap opens and once when it closes, however long it lasts', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH), bucketAt(2, ETH), bucketAt(3, ETH), bucketAt(4, ETH, BTC)]);
      expect(warnings()).toEqual([
        `Partial gap: no BTC/USDT candle at ${toISOString(at(1))}, filling with empty candles until it comes back`,
        `Partial gap closed: BTC/USDT is back at ${toISOString(at(4))}, 3 minute(s) filled with empty candles from ${toISOString(at(1))}`,
      ]);
    });

    it('should count the minutes of a total gap in the partial gap it interrupts', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH), bucketAt(4, ETH, BTC)]);
      expect(warning).toHaveBeenLastCalledWith(
        'stream',
        `Partial gap closed: BTC/USDT is back at ${toISOString(at(4))}, 3 minute(s) filled with empty candles from ${toISOString(at(1))}`,
      );
    });

    it('should warn about the partial gaps of each pair separately', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH), bucketAt(2, BTC), bucketAt(3, ETH, BTC)]);
      expect(warnings().map(message => message.split(',')[0])).toEqual([
        `Partial gap: no BTC/USDT candle at ${toISOString(at(1))}`,
        `Partial gap: no ETH/USDT candle at ${toISOString(at(2))}`,
        `Partial gap closed: BTC/USDT is back at ${toISOString(at(2))}`,
        `Partial gap closed: ETH/USDT is back at ${toISOString(at(3))}`,
      ]);
    });
  });

  describe('total gaps', () => {
    it('should fill every missing minute for every pair', async () => {
      const buckets = await run([bucketAt(0, ETH, BTC), bucketAt(3, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0', 'ETH1~ BTC1~', 'ETH2~ BTC2~', 'ETH3 BTC3']);
    });

    it('should fill only the pairs already seen', async () => {
      const buckets = await run([bucketAt(0, ETH), bucketAt(2, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0', 'ETH1~', 'ETH2 BTC2']);
    });

    it('should push no synthetic bucket when no pair was ever seen', async () => {
      const buckets = await run([bucketAt(0, 'LTC/USDT'), bucketAt(2, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['', 'ETH2 BTC2']);
    });

    it('should fill a total gap that follows a partial gap from the filled candles', async () => {
      const buckets = await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH), bucketAt(3, ETH, BTC)]);
      expect(describeBuckets(buckets)).toEqual(['ETH0 BTC0', 'ETH1 BTC1~', 'ETH2~ BTC2~', 'ETH3 BTC3']);
    });
    it('should warn once about a total gap', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(4, ETH, BTC)]);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        'stream',
        `Total gap detected: filling 3 minute(s) for all assets from ${toISOString(at(1))}`,
      );
    });

    it(`should fill a total gap of ${MAX_GAP_FILL_MINUTES} minutes`, async () => {
      const buckets = await run([bucketAt(0, ETH, BTC), bucketAt(MAX_GAP_FILL_MINUTES + 1, ETH, BTC)]);
      expect(buckets).toHaveLength(MAX_GAP_FILL_MINUTES + 2);
    });

    it(`should refuse to fill a total gap longer than ${MAX_GAP_FILL_MINUTES} minutes`, async () => {
      await expect(run([bucketAt(0, ETH, BTC), bucketAt(MAX_GAP_FILL_MINUTES + 2, ETH, BTC)])).rejects.toThrow(
        `No candle from ${toISOString(at(1))} to ${toISOString(at(MAX_GAP_FILL_MINUTES + 1))} (${MAX_GAP_FILL_MINUTES + 1} minutes): refusing to fill more than ${MAX_GAP_FILL_MINUTES} minutes with empty candles`,
      );
    });
  });

  describe('buckets that do not follow the last one', () => {
    it.each`
      case              | input                                                                                           | expected
      ${'duplicate'}    | ${[bucketAt(0, ETH, BTC), bucketAt(1, ETH, BTC), bucketAt(1, ETH, BTC), bucketAt(2, ETH, BTC)]} | ${['ETH0 BTC0', 'ETH1 BTC1', 'ETH2 BTC2']}
      ${'out-of-order'} | ${[bucketAt(0, ETH, BTC), bucketAt(2, ETH, BTC), bucketAt(1, ETH, BTC), bucketAt(3, ETH, BTC)]} | ${['ETH0 BTC0', 'ETH1~ BTC1~', 'ETH2 BTC2', 'ETH3 BTC3']}
    `('should ignore a $case bucket without moving the clock back', async ({ input, expected }) => {
      const buckets = await run(input);
      expect(describeBuckets(buckets)).toEqual(expected);
    });

    it('should warn about an ignored bucket', async () => {
      await run([bucketAt(0, ETH, BTC), bucketAt(1, ETH, BTC), bucketAt(0, ETH, BTC)]);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        'stream',
        `Ignoring the bucket of ${toISOString(at(0))}: it does not follow the last bucket pushed (${toISOString(at(1))})`,
      );
    });
  });

  describe('errors', () => {
    it('should forward an error thrown while reading a bucket', async () => {
      const unreadable: CandleBucket = new Map([[ETH, Object.defineProperty(candleAt(0), 'start', { get: throwUnreadable })]]);
      await expect(run([unreadable])).rejects.toThrow('unreadable');
    });
  });
});
