import { each } from 'lodash-es';
import { describe, expect, it } from 'vitest';
import { SMA } from './sma.indicator';

const candles = [
  { close: 81 },
  { close: 24 },
  { close: 75 },
  { close: 21 },
  { close: 34 },
  { close: 25 },
  { close: 72 },
  { close: 92 },
  { close: 99 },
  { close: 2 },
  { close: 86 },
  { close: 80 },
  { close: 76 },
  { close: 8 },
  { close: 87 },
  { close: 75 },
  { close: 32 },
  { close: 65 },
  { close: 41 },
  { close: 9 },
  { close: 13 },
  { close: 26 },
  { close: 56 },
  { close: 28 },
  { close: 65 },
  { close: 58 },
  { close: 17 },
  { close: 90 },
  { close: 87 },
  { close: 86 },
  { close: 99 },
  { close: 3 },
  { close: 70 },
  { close: 1 },
  { close: 27 },
  { close: 9 },
  { close: 92 },
  { close: 68 },
  { close: 9 },
];

describe('SMA', function () {
  const verified_SMA10results = [
    81, 52.5, 60, 50.25, 47, 43.333333333333336, 47.42857142857143, 53, 58.111111111111114, 52.5, 53, 58.6, 58.7, 57.4,
    62.7, 67.7, 63.7, 61, 55.2, 55.9, 48.6, 43.2, 41.2, 43.2, 41, 39.3, 37.8, 40.3, 44.9, 52.6, 61.2, 58.9, 60.3, 57.6,
    53.8, 48.9, 56.4, 54.2, 46.4,
  ];
  const verified_SMA12results = [
    81, 52.5, 60, 50.25, 47, 43.333333333333336, 47.42857142857143, 53, 58.111111111111114, 52.5, 55.54545454545455,
    57.583333333333336, 57.166666666666664, 55.833333333333336, 56.833333333333336, 61.333333333333336,
    61.166666666666664, 64.5, 61.916666666666664, 55, 47.833333333333336, 49.833333333333336, 47.333333333333336, 43,
    42.083333333333336, 46.25, 40.416666666666664, 41.666666666666664, 46.25, 48, 52.833333333333336,
    52.333333333333336, 57.083333333333336, 55, 52.583333333333336, 51, 53.25, 54.083333333333336, 53.416666666666664,
  ];
  const verified_SMA26results = [
    81, 52.5, 60, 50.25, 47, 43.333333333333336, 47.42857142857143, 53, 58.111111111111114, 52.5, 55.54545454545455,
    57.583333333333336, 59, 55.357142857142854, 57.46666666666667, 58.5625, 57, 57.44444444444444, 56.578947368421055,
    54.2, 52.23809523809524, 51.04545454545455, 51.26086956521739, 50.291666666666664, 50.88, 51.15384615384615,
    48.69230769230769, 51.23076923076923, 51.69230769230769, 54.19230769230769, 56.69230769230769, 55.84615384615385,
    55.76923076923077, 52.26923076923077, 49.5, 49.76923076923077, 50, 49.53846153846154, 46.96153846153846,
  ];

  it('should correctly calculate SMAs with period 10', () => {
    const sma = new SMA({ period: 10 });
    each(candles, (candle, index) => {
      sma.onNewCandle(candle);
      expect(sma.getResult()).toBe(verified_SMA10results[index]);
    });
  });

  it('should correctly calculate SMAs with window period 12', () => {
    const sma = new SMA({ period: 12 });
    each(candles, (candle, index) => {
      sma.onNewCandle(candle);
      expect(sma.getResult()).toBe(verified_SMA12results[index]);
    });
  });

  it('should correctly calculate SMAs with window period 26', () => {
    const sma = new SMA({ period: 26 });
    each(candles, (candle, index) => {
      sma.onNewCandle(candle);
      expect(sma.getResult()).toBe(verified_SMA26results[index]);
    });
  });
});
