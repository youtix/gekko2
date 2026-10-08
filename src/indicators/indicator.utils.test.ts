import { describe, expect, it } from 'vitest';
import { getInputSource } from './indicator.utils';

describe('getInputSource', () => {
  // Seven different prices, so that a source read from the wrong field cannot pass
  const candle = { start: 0, open: 13, high: 20, low: 4, close: 18, volume: 100 };
  it.each`
    src          | price
    ${'open'}    | ${13}
    ${'high'}    | ${20}
    ${'low'}     | ${4}
    ${'close'}   | ${18}
    ${'hl2'}     | ${12}
    ${'hlc3'}    | ${14}
    ${'ohlc4'}   | ${13.75}
    ${undefined} | ${18}
  `('should read $price from the candle when src is $src', ({ src, price }) => {
    expect(getInputSource(src)(candle)).toBe(price);
  });
});
