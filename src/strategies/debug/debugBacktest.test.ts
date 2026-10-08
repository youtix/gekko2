import type { TradingPair } from '@models/utility.types';
import { OrderRecorder } from '@strategies/positionTracker.mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { playCandles, toolsOf } from './debug.mock';
import { DebugBacktest } from './debugBacktest.strategy';
import { DebugBacktestParams } from './debugBacktest.types';

const BTC: TradingPair = 'BTC/USDT';
const ETH: TradingPair = 'ETH/USDT';

describe('DebugBacktest', () => {
  let strategy: DebugBacktest;
  let orders: OrderRecorder;

  /** Plays `count` candles of `pairs` with the strategy block parsed as `params`: see playCandles */
  const play = (count: number, params: DebugBacktestParams, pairs: TradingPair[] = [BTC]) => {
    return playCandles(strategy, toolsOf(params, { createOrder: orders.createOrder }), orders, count, pairs);
  };

  beforeEach(() => {
    strategy = new DebugBacktest();
    orders = new OrderRecorder();
  });

  // Counted from 1, the first candle after the warmup was index 1: buyCandleIndex 0 never bought
  it.each`
    buy       | sell      | calendar
    ${0}      | ${3}      | ${'B . . S .'}
    ${1}      | ${4}      | ${'. B . . S'}
    ${[1, 5]} | ${[3, 7]} | ${'. B . S . B . S .'}
    ${[0, 2]} | ${[]}     | ${'B . B .'}
    ${2}      | ${2}      | ${'. . BS .'}
  `('orders on the candles listed, counted from 0, the first after the warmup: buy $buy, sell $sell', ({ buy, sell, calendar }) => {
    expect(play(calendar.split(' ').length, { buyCandleIndex: buy, sellCandleIndex: sell })).toBe(calendar);
  });

  it('sends a MARKET order of 1 unit, for a PnL known to the unit', () => {
    play(2, { buyCandleIndex: 0, sellCandleIndex: 1 });
    expect(orders.advices).toStrictEqual([
      { type: 'MARKET', side: 'BUY', amount: 1, symbol: BTC },
      { type: 'MARKET', side: 'SELL', amount: 1, symbol: BTC },
    ]);
  });

  it('orders on every watched pair', () => {
    play(2, { buyCandleIndex: 0, sellCandleIndex: 1 }, [BTC, ETH]);
    expect(orders.advices.map(({ side, symbol }) => `${side} ${symbol}`)).toEqual([
      'BUY BTC/USDT',
      'BUY ETH/USDT',
      'SELL BTC/USDT',
      'SELL ETH/USDT',
    ]);
  });
});
