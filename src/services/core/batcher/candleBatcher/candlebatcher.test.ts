import { compact, first, map, max, min } from 'lodash-es';
import { beforeEach, describe, expect, it } from 'vitest';
import { Candle } from '../../../../models/candle.types';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { CandleBatcher } from './candleBatcher';

const candles = [
  {
    id: 1,
    start: toTimestamp('2015-02-14T23:57:00.000Z'),
    open: 257.19,
    high: 257.19,
    low: 257.18,
    close: 257.18,
    volume: 0.97206065,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 2,
    start: toTimestamp('2015-02-14T23:58:00.000Z'),
    open: 257.02,
    high: 257.02,
    low: 256.98,
    close: 256.98,
    volume: 4.1407478,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 3,
    start: toTimestamp('2015-02-14T23:59:00.000Z'),
    open: 256.85,
    high: 256.99,
    low: 256.85,
    close: 256.99,
    volume: 6,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 4,
    start: toTimestamp('2015-02-15T00:00:00.000Z'),
    open: 256.81,
    high: 256.82,
    low: 256.81,
    close: 256.82,
    volume: 4,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 5,
    start: toTimestamp('2015-02-15T00:01:00.000Z'),
    open: 256.81,
    high: 257.02,
    low: 256.81,
    close: 257.01,
    volume: 6,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 6,
    start: toTimestamp('2015-02-15T00:02:00.000Z'),
    open: 257.03,
    high: 257.03,
    low: 256.33,
    close: 256.33,
    volume: 6.7551178,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 7,
    start: toTimestamp('2015-02-15T00:03:00.000Z'),
    open: 257.02,
    high: 257.47,
    low: 257.02,
    close: 257.47,
    volume: 3.7384995300000003,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 8,
    start: toTimestamp('2015-02-15T00:04:00.000Z'),
    open: 257.47,
    high: 257.48,
    low: 257.37,
    close: 257.38,
    volume: 8,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 9,
    start: toTimestamp('2015-02-15T00:05:00.000Z'),
    open: 257.38,
    high: 257.45,
    low: 257.38,
    close: 257.45,
    volume: 7.97062564,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
  {
    id: 10,
    start: toTimestamp('2015-02-15T00:06:00.000Z'),
    open: 257.46,
    high: 257.48,
    low: 257.46,
    close: 257.48,
    volume: 7.5,
    volumeActive: 0,
    quoteVolume: 0,
    quoteVolumeActive: 0,
  },
];
describe('candleBatcher', () => {
  let candleBatcher: CandleBatcher;

  beforeEach(() => {
    candleBatcher = new CandleBatcher(2);
  });

  it('should NOT create a candle when fed not enough small candles', () => {
    const candle = { ...candles[0], start: toTimestamp('2025-05-10T23:58:00.000Z') };
    const result = candleBatcher.addSmallCandle(candle);
    expect(result).toBeUndefined();
  });

  it('should return 5 results when fed 10 candles', () => {
    const result = compact(map(candles, candleBatcher.addSmallCandle.bind(candleBatcher)));
    expect(result).toHaveLength(5);
  });

  it('should correctly add two candles together', () => {
    const firstCandle = { ...candles[0], start: toTimestamp('2025-05-10T23:58:00.000Z') };
    const secondCandle = { ...candles[1], start: toTimestamp('2025-05-10T23:59:00.000Z') };

    const expectedResult = {
      start: firstCandle?.start,
      open: firstCandle?.open,
      high: max([firstCandle?.high, secondCandle?.high]),
      low: min([firstCandle?.low, secondCandle?.low]),
      close: secondCandle?.close,
      volume: 5.11280845,
      volumeActive: 0,
      quoteVolume: 0,
      quoteVolumeActive: 0,
    };
    const result: (Candle | undefined)[] = [];
    result.push(candleBatcher.addSmallCandle(firstCandle));
    result.push(candleBatcher.addSmallCandle(secondCandle));

    expect(compact(result)).toStrictEqual([expectedResult]);
    expect(first(compact(result))?.id).toBeUndefined();
  });

  it.each`
    description                        | startDate                     | candleSize | expected
    ${'one minute timeframe'}          | ${'2025-05-10T23:59:00.000Z'} | ${1}       | ${true}
    ${'first candle of 2m timeframe'}  | ${'2025-05-10T23:58:00.000Z'} | ${2}       | ${false}
    ${'last candle of 2m timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${2}       | ${true}
    ${'first candle of 3m timeframe'}  | ${'2025-05-10T23:57:00.000Z'} | ${3}       | ${false}
    ${'last candle of 3m timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${3}       | ${true}
    ${'first candle of 5m timeframe'}  | ${'2025-05-10T23:55:00.000Z'} | ${5}       | ${false}
    ${'last candle of 5m timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${5}       | ${true}
    ${'first candle of 10m timeframe'} | ${'2025-05-10T23:50:00.000Z'} | ${10}      | ${false}
    ${'last candle of 10m timeframe'}  | ${'2025-05-10T23:59:00.000Z'} | ${10}      | ${true}
    ${'first candle of 15m timeframe'} | ${'2025-05-10T23:45:00.000Z'} | ${15}      | ${false}
    ${'last candle of 15m timeframe'}  | ${'2025-05-10T23:59:00.000Z'} | ${15}      | ${true}
    ${'first candle of 30m timeframe'} | ${'2025-05-10T23:30:00.000Z'} | ${30}      | ${false}
    ${'last candle of 30m timeframe'}  | ${'2025-05-10T23:59:00.000Z'} | ${30}      | ${true}
    ${'first candle of 1h timeframe'}  | ${'2025-05-10T23:00:00.000Z'} | ${60}      | ${false}
    ${'last candle of 1h timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${60}      | ${true}
    ${'first candle of 2h timeframe'}  | ${'2025-05-10T22:00:00.000Z'} | ${120}     | ${false}
    ${'last candle of 2h timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${120}     | ${true}
    ${'first candle of 4h timeframe'}  | ${'2025-05-10T20:00:00.000Z'} | ${240}     | ${false}
    ${'last candle of 4h timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${240}     | ${true}
    ${'first candle of 6h timeframe'}  | ${'2025-05-10T18:00:00.000Z'} | ${360}     | ${false}
    ${'last candle of 6h timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${360}     | ${true}
    ${'first candle of 8h timeframe'}  | ${'2025-05-10T16:00:00.000Z'} | ${480}     | ${false}
    ${'last candle of 8h timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${480}     | ${true}
    ${'first candle of 12h timeframe'} | ${'2025-05-10T12:00:00.000Z'} | ${720}     | ${false}
    ${'last candle of 12h timeframe'}  | ${'2025-05-10T23:59:00.000Z'} | ${720}     | ${true}
    ${'first candle of 1d timeframe'}  | ${'2025-05-10T00:00:00.000Z'} | ${1440}    | ${false}
    ${'last candle of 1d timeframe'}   | ${'2025-05-10T23:59:00.000Z'} | ${1440}    | ${true}
    ${'first candle of 1w timeframe'}  | ${'2025-05-12T00:00:00.000Z'} | ${10080}   | ${false}
    ${'last candle of 1w timeframe'}   | ${'2025-05-18T23:59:00.000Z'} | ${10080}   | ${true}
    ${'first candle of 1M timeframe'}  | ${'2025-05-01T00:00:00.000Z'} | ${43200}   | ${false}
    ${'last candle of 1M timeframe'}   | ${'2025-05-31T23:59:00.000Z'} | ${43200}   | ${true}
    ${'first candle of 3M timeframe'}  | ${'2025-01-31T23:59:00.000Z'} | ${129600}  | ${false}
    ${'last candle of 3M timeframe'}   | ${'2025-03-31T23:59:00.000Z'} | ${129600}  | ${true}
    ${'first candle of 6M timeframe'}  | ${'2025-01-01T00:00:00.000Z'} | ${259200}  | ${false}
    ${'last candle of 6M timeframe'}   | ${'2025-06-30T23:59:00.000Z'} | ${259200}  | ${true}
    ${'first candle of 1y timeframe'}  | ${'2025-01-01T00:00:00.000Z'} | ${518400}  | ${false}
    ${'last candle of 1y timeframe'}   | ${'2025-12-31T23:59:00.000Z'} | ${518400}  | ${true}
  `('should return $expected when it is the $description for $startDate', ({ startDate, candleSize, expected }) => {
    const lastCandle = { ...candles[0], start: toTimestamp(startDate) };
    candleBatcher['candleSize'] = candleSize;
    const result = candleBatcher['isBigCandleReady'](lastCandle);
    expect(result).toBe(expected);
  });
});
