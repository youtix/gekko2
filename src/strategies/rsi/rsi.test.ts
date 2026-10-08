import type { StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RSI } from './rsi.strategy';
import { RSIStrategyParams } from './rsi.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    src: 'close',
    thresholds: { high: 70, low: 30, persistence: 2 },
  }));
  return { config: new Configuration() };
});

const symbol = 'BTC/USDT';
// The RSI value (thresholds 70 / 30) of each step of the scenarios played below
const RSI_VALUES = { high: 75, low: 20, neutral: 50 } as const;

describe('RSI Strategy', () => {
  let strategy: RSI;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /** Plays the steps (see playSteps): an RSI value (high, low, neutral) is a candle */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step =>
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: RSI_VALUES[step as keyof typeof RSI_VALUES],
        symbol,
      }),
    );
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new RSI();
    orders = new OrderRecorder();
    advices = orders.advices;
    addIndicator = vi.fn();

    tools = {
      strategyParams: { period: 14, src: 'close', thresholds: { high: 70, low: 30, persistence: 2 } },
      createOrder: orders.createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<RSIStrategyParams>);
  });

  describe('init', () => {
    it('should add RSI indicator with strategy period and src', () => {
      expect(addIndicator).toHaveBeenCalledWith('RSI', symbol, { period: 14, src: 'close' });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new RSI();
      emptyStrategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it.each`
      rsiRes
      ${undefined}
      ${null}
      ${'invalid'}
    `('should do nothing when RSI result is invalid ($rsiRes)', ({ rsiRes }) => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: rsiRes,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it('should emit a STICKY BUY advice after persistence on low trend when flat', () => {
      play('low low');
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol }]);
    });

    it('should emit a STICKY SELL advice after persistence on high trend when long', () => {
      play('low low completed:1 high high');
      expect(advices[1]).toEqual({ type: 'STICKY', side: 'SELL', amount: 1, symbol });
    });

    it.each`
      case                                        | steps                                                        | expectedSides
      ${'a low trend before persistence'}         | ${'low'}                                                     | ${[]}
      ${'a low trend that continues'}             | ${'low low low'}                                             | ${['BUY']}
      ${'a high trend before persistence'}        | ${'low low completed:1 high'}                                | ${['BUY']}
      ${'a high trend that continues'}            | ${'low low completed:1 high high high'}                      | ${['BUY', 'SELL']}
      ${'a switch from low to high and back'}     | ${'low low completed:1 high high completed:2 low low'}       | ${['BUY', 'SELL', 'BUY']}
      ${'neutral values'}                         | ${'neutral neutral'}                                         | ${[]}
      ${'a low trend after a shorter high trend'} | ${'low low high low low'}                                    | ${['BUY']}
      ${'a low trend while long'}                 | ${'low low completed:1 neutral low low'}                     | ${['BUY']}
      ${'a high trend after a shorter low trend'} | ${'low low completed:1 high high completed:2 low high high'} | ${['BUY', 'SELL']}
      ${'a high trend when flat'}                 | ${'high high high'}                                          | ${[]}
      ${'a high trend while the BUY pends'}       | ${'low low high high'}                                       | ${['BUY']}
      ${'a high trend once the BUY filled'}       | ${'low low high high completed:1 high'}                      | ${['BUY', 'SELL']}
      ${'a low trend while the SELL pends'}       | ${'low low completed:1 high high low low'}                   | ${['BUY', 'SELL']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('order outcomes', () => {
    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                                   | steps                                                            | expectedSides
      ${'a BUY completed: long, it sells'}                   | ${'low low completed:1 high high'}                               | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next trend'}   | ${'low low canceled:1 low high low low'}                         | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next trend'}    | ${'low low errored:1 low high low low'}                          | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}             | ${'low low completed:1 high high completed:2 low low'}           | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next trend'} | ${'low low completed:1 high high canceled:2 high low high high'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next trend'}  | ${'low low completed:1 high high errored:2 high low high high'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'}     | ${'low low completed:1 high high errored:2:0 low low'}           | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}            | ${'low low completed:unknown low high high'}                     | ${['BUY']}
      ${'another order canceled: still pending'}             | ${'low low canceled:unknown low high high'}                      | ${['BUY']}
      ${'another order errored: still pending'}              | ${'low low errored:unknown low high high'}                       | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { period: 14, src: 'close', thresholds: { high: 70, low: 30, persistence: 1 } };
    const onOhlc4 = { period: 21, src: 'ohlc4', thresholds: { high: 70, low: 30, persistence: 0 } };
    const withThresholds = (thresholds: object) => ({ ...params, thresholds: { ...params.thresholds, ...thresholds } });

    it.each`
      scenario                               | block                  | expected
      ${'the documentation example'}         | ${params}              | ${params}
      ${'a persistence of 0, on ohlc4'}      | ${onOhlc4}             | ${onOhlc4}
      ${'a block without src, on the close'} | ${omit(params, 'src')} | ${params}
    `('accepts $scenario', ({ block, expected }) => {
      expect(RSI.schema.parse(block)).toEqual(expected);
    });

    it('refuses a misspelt high threshold (hight)', () => {
      expect(RSI.schema.safeParse({ ...params, thresholds: { hight: 70, low: 30, persistence: 1 } }).error?.issues).toMatchObject([
        { path: ['thresholds', 'high'] },
        { code: 'unrecognized_keys', keys: ['hight'], path: ['thresholds'] },
      ]);
    });

    it.each`
      scenario                                         | block                                       | path
      ${'a quoted period'}                             | ${{ ...params, period: '14' }}              | ${['period']}
      ${'a fractional period'}                         | ${{ ...params, period: 14.5 }}              | ${['period']}
      ${'a period of 0'}                               | ${{ ...params, period: 0 }}                 | ${['period']}
      ${'an unknown source'}                           | ${{ ...params, src: 'hcl3' }}               | ${['src']}
      ${'a misspelt src (scr), not left to the close'} | ${{ ...omit(params, 'src'), scr: 'ohlc4' }} | ${[]}
      ${'a missing thresholds block'}                  | ${omit(params, 'thresholds')}               | ${['thresholds']}
      ${'a quoted threshold'}                          | ${withThresholds({ high: '70' })}           | ${['thresholds', 'high']}
      ${'an infinite threshold'}                       | ${withThresholds({ low: -Infinity })}       | ${['thresholds', 'low']}
      ${'a negative persistence'}                      | ${withThresholds({ persistence: -1 })}      | ${['thresholds', 'persistence']}
    `('refuses $scenario', ({ block, path }) => {
      expect(RSI.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });
  });
});
