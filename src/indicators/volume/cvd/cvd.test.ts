import { describe, expect, it } from 'vitest';
import { Candle } from '@models/candle.types';
import { CVD } from './cvd.indicator';

describe('CVD', () => {
  const seq: Candle[] = [
    {
      start: 1,
      open: 1,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 10,
      volumeActive: 7,
      quoteVolume: 100,
      quoteVolumeActive: 60,
    },
    {
      start: 2,
      open: 1.05,
      high: 1.15,
      low: 0.95,
      close: 1.1,
      volume: 8,
      volumeActive: 3,
      quoteVolume: 80,
      quoteVolumeActive: 25,
    },
    {
      start: 3,
      open: 1.1,
      high: 1.2,
      low: 1.0,
      close: 1.15,
      volume: 12,
      volumeActive: 6,
      quoteVolume: 120,
      quoteVolumeActive: 70,
    },
    {
      start: 4,
      open: 1.15,
      high: 1.25,
      low: 1.05,
      close: 1.2,
      volume: 5,
      quoteVolume: 50,
    },
  ];

  it.each`
    source     | candles | expected
    ${'quote'} | ${seq}  | ${-50}
    ${'base'}  | ${seq}  | ${-5}
  `(
    'computes CVD delta using $source',
    ({ source, candles, expected }: { source: 'quote' | 'base'; candles: Candle[]; expected: number }) => {
      const cvd = new CVD({ source });
      candles.forEach(c => cvd.onNewCandle(c));
      expect(cvd.getResult()).toBeCloseTo(expected, 10);
    },
  );
});
