import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
} from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MACD } from './macd.strategy';
import { MACDStrategyParams } from './macd.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    short: 12,
    long: 26,
    signal: 9,
    macdSrc: 'macd',
    thresholds: { up: 0.5, down: -0.5, persistence: 2 },
  }));
  return { config: new Configuration() };
});

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;
// The MACD value (macdSrc: 'macd', thresholds 0.5 / -0.5) of each step of the scenarios played below
const MACD_VALUES = { up: 1, down: -1, none: 0 } as const;
const UNKNOWN_ORDER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('MACD Strategy', () => {
  let strategy: MACD;
  let advices: AdviceOrder[];
  let orderIds: UUID[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /**
   * Plays the steps, separated by spaces: a trend (up, down, none) is a candle, '<outcome>:<n>' relays the outcome (completed,
   * canceled, errored) of the n-th order created, '<outcome>:unknown' that of an order the strategy did not create.
   */
  const play = (steps: string) => {
    for (const step of steps.split(' ')) {
      const [kind, order] = step.split(':');
      if (!order) {
        const macd = MACD_VALUES[kind as keyof typeof MACD_VALUES];
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
          ...makeIndicator({ macd, signal: 0, hist: 0 }),
        );
        continue;
      }
      const id = order === 'unknown' ? UNKNOWN_ORDER_ID : orderIds[Number(order) - 1];
      if (kind === 'completed') strategy.onOrderCompleted({ order: { id } } as unknown as OnOrderCompletedEventParams<MACDStrategyParams>);
      if (kind === 'canceled') strategy.onOrderCanceled({ order: { id } } as unknown as OnOrderCanceledEventParams<MACDStrategyParams>);
      if (kind === 'errored') strategy.onOrderErrored({ order: { id } } as unknown as OnOrderErroredEventParams<MACDStrategyParams>);
    }
  };
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new MACD();
    advices = [];
    orderIds = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      const id = `00000000-0000-0000-0000-${String(advices.length).padStart(12, '0')}` as UUID;
      orderIds.push(id);
      return id;
    });

    tools = {
      strategyParams: {
        short: 12,
        long: 26,
        signal: 9,
        macdSrc: 'macd',
        thresholds: { up: 0.5, down: -0.5, persistence: 2 },
      },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<MACDStrategyParams>);
  });

  describe('init', () => {
    it('should add MACD indicator with strategy parameters', () => {
      expect(addIndicator).toHaveBeenCalledWith('MACD', symbol, { short: 12, long: 26, signal: 9 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new MACD();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
      ${{ macd: 'not_number', signal: 0, hist: 0 }}
      ${{ macd: 1, signal: 'not_number', hist: 0 }}
      ${{ macd: 1, signal: 0, hist: 'not_number' }}
    `('should do nothing when MACD result is invalid ($macdRes)', ({ macdRes }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator(macdRes),
      );
      expect(advices).toHaveLength(0);
    });

    it('should emit a STICKY BUY advice after persistence on uptrend when flat', () => {
      play('up up');
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol }]);
    });

    it('should emit a STICKY SELL advice after persistence on downtrend when long', () => {
      play('up up completed:1 down down');
      expect(advices[1]).toEqual({ type: 'STICKY', side: 'SELL', amount: 1, symbol });
    });

    it.each`
      case                                      | steps                                                     | expectedSides
      ${'an uptrend before persistence'}        | ${'up'}                                                   | ${[]}
      ${'an uptrend that continues'}            | ${'up up up'}                                             | ${['BUY']}
      ${'a downtrend before persistence'}       | ${'up up completed:1 down'}                               | ${['BUY']}
      ${'a downtrend that continues'}           | ${'up up completed:1 down down down'}                     | ${['BUY', 'SELL']}
      ${'a switch from up to down and back'}    | ${'up up completed:1 down down completed:2 up up'}        | ${['BUY', 'SELL', 'BUY']}
      ${'an uptrend after a shorter downtrend'} | ${'up up down up up'}                                     | ${['BUY']}
      ${'an uptrend while long'}                | ${'up up completed:1 down up up'}                         | ${['BUY']}
      ${'a downtrend after a shorter uptrend'}  | ${'up up completed:1 down down completed:2 up down down'} | ${['BUY', 'SELL']}
      ${'a downtrend when flat'}                | ${'down down down'}                                       | ${[]}
      ${'a downtrend while the BUY pends'}      | ${'up up down down'}                                      | ${['BUY']}
      ${'an uptrend once the SELL filled'}      | ${'up up completed:1 down down up up completed:2 up'}     | ${['BUY', 'SELL', 'BUY']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should log when no trend detected', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 0, signal: 0, hist: 0 }),
      );
      expect(logs).toContainEqual({ level: 'debug', message: 'MACD: no trend detected' });
      expect(advices).toHaveLength(0);
    });
  });

  describe('order outcomes', () => {
    it.each`
      case                                                   | steps                                                         | expectedSides
      ${'a BUY completed: long, it sells'}                   | ${'up up completed:1 down down'}                              | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next trend'}   | ${'up up canceled:1 up down up up'}                           | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next trend'}    | ${'up up errored:1 up down up up'}                            | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}             | ${'up up completed:1 down down completed:2 up up'}            | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next trend'} | ${'up up completed:1 down down canceled:2 down up down down'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next trend'}  | ${'up up completed:1 down down errored:2 down up down down'}  | ${['BUY', 'SELL', 'SELL']}
      ${'another order completed: still pending'}            | ${'up up completed:unknown up down down'}                     | ${['BUY']}
      ${'another order canceled: still pending'}             | ${'up up canceled:unknown up down down'}                      | ${['BUY']}
      ${'another order errored: still pending'}              | ${'up up errored:unknown up down down'}                       | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('log', () => {
    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
    `('should not log when MACD result is missing or invalid ($macdRes)', ({ macdRes }) => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>, ...makeIndicator(macdRes));
      expect(logs).toHaveLength(0);
    });

    it('should log MACD properties', () => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1.12345678, signal: 2.12345678, hist: 3.12345678 }),
      );
      expect(logs).toContainEqual({ level: 'debug', message: 'macd: 1.12345678' });
      expect(logs).toContainEqual({ level: 'debug', message: 'signal: 2.12345678' });
      expect(logs).toContainEqual({ level: 'debug', message: 'hist: 3.12345678' });
    });
  });

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { short: 12, long: 26, signal: 9, macdSrc: 'hist', thresholds: { up: 0, down: 0, persistence: 1 } };
    const withThresholds = (thresholds: object) => ({ ...params, thresholds: { ...params.thresholds, ...thresholds } });

    it('accepts the documentation example as it is', () => {
      expect(MACD.schema.parse(params)).toEqual(params);
    });

    it('refuses a misspelt persistence (persistance)', () => {
      expect(MACD.schema.safeParse({ ...params, thresholds: { up: 0, down: 0, persistance: 1 } }).error?.issues).toMatchObject([
        { path: ['thresholds', 'persistence'] },
        { code: 'unrecognized_keys', keys: ['persistance'], path: ['thresholds'] },
      ]);
    });

    // A period of 0 is refused once, without the comparison of the periods
    it.each`
      scenario                                 | block                                   | path
      ${'an unknown macdSrc (histogram)'}      | ${{ ...params, macdSrc: 'histogram' }}  | ${['macdSrc']}
      ${'a missing macdSrc'}                   | ${omit(params, 'macdSrc')}              | ${['macdSrc']}
      ${'a quoted signal'}                     | ${{ ...params, signal: '9' }}           | ${['signal']}
      ${'a fractional long'}                   | ${{ ...params, long: 26.5 }}            | ${['long']}
      ${'a short of 0'}                        | ${{ ...params, short: 0 }}              | ${['short']}
      ${'a long of 0'}                         | ${{ ...params, long: 0 }}               | ${['long']}
      ${'a signal of 0'}                       | ${{ ...params, signal: 0 }}             | ${['signal']}
      ${'swapped periods (short 26, long 12)'} | ${{ ...params, short: 26, long: 12 }}   | ${[]}
      ${'equal periods'}                       | ${{ ...params, short: 26, long: 26 }}   | ${[]}
      ${'an infinite threshold'}               | ${withThresholds({ up: Infinity })}     | ${['thresholds', 'up']}
      ${'a fractional persistence'}            | ${withThresholds({ persistence: 0.5 })} | ${['thresholds', 'persistence']}
      ${'a src, which the MACD does not take'} | ${{ ...params, src: 'close' }}          | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(MACD.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it('says why it refuses swapped periods', () => {
      expect(MACD.schema.safeParse({ ...params, short: 26, long: 12 }).error?.issues[0].message).toBe(
        'short must be below long (swapped periods give the opposite MACD, equal ones a MACD of 0)',
      );
    });
  });
});
