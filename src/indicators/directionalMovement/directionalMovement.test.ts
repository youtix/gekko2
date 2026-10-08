import { Indicator } from '@indicators/indicator';
import { getTrueRange } from '@indicators/volatility/trueRange/trueRange.utils';
import { Candle } from '@models/candle.types';
import { describe, expect, it, vi } from 'vitest';
import { ADX } from './adx/adx.indicator';
import { ADXRibbon } from './adxRibbon/adxRibbon.indicator';
import { DX } from './dx/dx.indicator';
import { MinusDI } from './minusDI/minusDI.indicator';
import { MinusDM } from './minusDM/minusDM.indicator';
import { PlusDI } from './plusDI/plusDI.indicator';
import { PlusDM } from './plusDM/plusDM.indicator';

// The real true range runs (vi.fn(impl) survives mockReset), spied to count how often each candle's is computed
vi.mock('@indicators/volatility/trueRange/trueRange.utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@indicators/volatility/trueRange/trueRange.utils')>();
  return { getTrueRange: vi.fn(actual.getTrueRange) };
});

const zigzag: Candle[] = Array.from({ length: 40 }, (_, index) => {
  const close = 100 + 10 * Math.sin(index / 3) + 5 * Math.sin(index / 7);
  return { start: index * 60_000, open: close, high: close + 1 + (index % 3), low: close - 1 - (index % 5), close, volume: 100 };
});

const resultsOf = (indicator: Indicator, candles: Candle[]) =>
  candles.map(candle => {
    indicator.onNewCandle(candle);
    return indicator.getResult();
  });

describe('DirectionalMovement', () => {
  // DX used to build a PlusDI and a MinusDI, which each computed the true range of every candle: twice per candle, and 38 times in the
  // default ribbon of 19 ADXs. Both DIs now read one directional movement
  it.each`
    name           | create                           | perCandle
    ${'DX'}        | ${() => new DX({ period: 14 })}  | ${1}
    ${'ADX'}       | ${() => new ADX({ period: 14 })} | ${1}
    ${'ADXRibbon'} | ${() => new ADXRibbon()}         | ${19}
  `('should compute the true range of each candle after the first $perCandle time(s) for $name', ({ create, perCandle }) => {
    resultsOf(create(), zigzag);
    expect(getTrueRange).toHaveBeenCalledTimes(perCandle * (zigzag.length - 1));
  });

  // As in TA-Lib: a DI over a true range of 0 is 0, and so is the DX of two DIs of 0, rather than 0/0
  const flat: Candle = { start: 0, open: 10, high: 10, low: 10, close: 10, volume: 0 };
  it.each`
    name         | create                              | expected
    ${'PlusDM'}  | ${() => new PlusDM({ period: 2 })}  | ${[null, 0, 0, 0]}
    ${'MinusDM'} | ${() => new MinusDM({ period: 2 })} | ${[null, 0, 0, 0]}
    ${'PlusDI'}  | ${() => new PlusDI({ period: 2 })}  | ${[null, null, 0, 0]}
    ${'MinusDI'} | ${() => new MinusDI({ period: 2 })} | ${[null, null, 0, 0]}
    ${'DX'}      | ${() => new DX({ period: 2 })}      | ${[null, null, 0, 0]}
  `('should return $expected for $name on candles that never move', ({ create, expected }) => {
    expect(resultsOf(create(), [flat, flat, flat, flat])).toEqual(expected);
  });

  // A candle that reaches as far above the previous high as below the previous low has no direction: neither DM counts the move
  const outside: Candle[] = [
    { start: 0, open: 9, high: 10, low: 8, close: 9, volume: 1 },
    { start: 60_000, open: 9, high: 11, low: 7, close: 9, volume: 1 },
  ];
  it.each`
    name         | create
    ${'PlusDM'}  | ${() => new PlusDM({ period: 1 })}
    ${'MinusDM'} | ${() => new MinusDM({ period: 1 })}
  `('should return 0 for $name on a candle that moves as far up as down', ({ create }) => {
    expect(resultsOf(create(), outside)).toEqual([null, 0]);
  });
});
