import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
import { findCandleIndexByTimestamp } from './dummyCentralizedExchange.utils';

describe('findCandleIndexByTimestamp', () => {
  const c = (start: number) => ({ start }) as Candle;

  it.each`
    description                                     | candles                                | timestamp | expected
    ${'should return 0 for empty array'}            | ${[]}                                  | ${100}    | ${0}
    ${'should return 0 if ts < first'}              | ${[c(100), c(200)]}                    | ${50}     | ${0}
    ${'should return 0 if ts == first'}             | ${[c(100), c(200)]}                    | ${100}    | ${0}
    ${'should return 1 if ts > first and < second'} | ${[c(100), c(200)]}                    | ${150}    | ${1}
    ${'should return 1 if ts == second'}            | ${[c(100), c(200)]}                    | ${200}    | ${1}
    ${'should return length if ts > last'}          | ${[c(100), c(200)]}                    | ${250}    | ${2}
    ${'should work with one item (ts < start)'}     | ${[c(100)]}                            | ${50}     | ${0}
    ${'should work with one item (ts == start)'}    | ${[c(100)]}                            | ${100}    | ${0}
    ${'should work with one item (ts > start)'}     | ${[c(100)]}                            | ${150}    | ${1}
    ${'should correct index in larger array'}       | ${[c(10), c(20), c(30), c(40), c(50)]} | ${35}     | ${3}
    ${'should correct index in larger array (hit)'} | ${[c(10), c(20), c(30), c(40), c(50)]} | ${30}     | ${2}
  `('$description', ({ candles, timestamp, expected }) => {
    expect(findCandleIndexByTimestamp(candles, timestamp)).toBe(expected);
  });
});
