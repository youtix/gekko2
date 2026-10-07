import { AdviceOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
} from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMA } from './dema.strategy';
import { DEMAStrategyParams } from './dema.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    thresholds: { up: 0.5, down: -0.5 },
  }));
  return { config: new Configuration() };
});

// The DEMA and SMA results of each step of the scenarios played below: diff = SMA - DEMA against the thresholds 0.5 / -0.5
const TRENDS = { up: { dema: 1, sma: 2 }, down: { dema: 1, sma: 0 }, neutral: { dema: 1, sma: 1 } } as const;
const UNKNOWN_ORDER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('DEMA Strategy', () => {
  let strategy: DEMA;
  let advices: AdviceOrder[];
  let orderIds: UUID[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /**
   * Plays the steps, separated by spaces: a trend (up, down, neutral) is a candle, '<outcome>:<n>' relays the outcome (completed,
   * canceled, errored) of the n-th order created, '<outcome>:unknown' that of an order the strategy did not create.
   */
  const play = (steps: string) => {
    for (const step of steps.split(' ')) {
      const [kind, order] = step.split(':');
      if (!order) {
        const { dema, sma } = TRENDS[kind as keyof typeof TRENDS];
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
          { results: dema, symbol: 'BTC/USDT' },
          { results: sma, symbol: 'BTC/USDT' },
        );
        continue;
      }
      const id = order === 'unknown' ? UNKNOWN_ORDER_ID : orderIds[Number(order) - 1];
      if (kind === 'completed') strategy.onOrderCompleted({ order: { id } } as unknown as OnOrderCompletedEventParams<DEMAStrategyParams>);
      if (kind === 'canceled') strategy.onOrderCanceled({ order: { id } } as unknown as OnOrderCanceledEventParams<DEMAStrategyParams>);
      if (kind === 'errored') strategy.onOrderErrored({ order: { id } } as unknown as OnOrderErroredEventParams<DEMAStrategyParams>);
    }
  };
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new DEMA();
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
      strategyParams: { period: 14, thresholds: { up: 0.5, down: -0.5 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set('BTC/USDT', { close: 10 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<DEMAStrategyParams>);
  });

  describe('init', () => {
    it('should add DEMA indicator with strategy period', () => {
      expect(addIndicator).toHaveBeenCalledWith('DEMA', 'BTC/USDT', { period: 14 });
    });

    it('should add SMA indicator with strategy period', () => {
      expect(addIndicator).toHaveBeenCalledWith('SMA', 'BTC/USDT', { period: 14 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new DEMA();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(0);
    });

    it('should do nothing if candle for the pair is not found', () => {
      const emptyBucket = new Map();
      strategy.onTimeframeCandleAfterWarmup(
        { candle: emptyBucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      smaRes       | demaRes      | expectedAdvices
      ${undefined} | ${undefined} | ${0}
      ${1}         | ${undefined} | ${0}
      ${undefined} | ${2}         | ${0}
      ${'invalid'} | ${2}         | ${0}
    `('should do nothing when results are invalid (sma: $smaRes, dema: $demaRes)', ({ smaRes, demaRes, expectedAdvices }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(expectedAdvices);
    });

    it('should emit a STICKY BUY advice when diff is 1 (uptrend) and flat', () => {
      play('up');
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
    });

    it('should emit a STICKY SELL advice when diff is -1 (downtrend) and long', () => {
      play('up completed:1 down');
      expect(advices[1]).toEqual({ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' });
    });

    it.each`
      case                                     | steps                                      | expectedSides
      ${'an uptrend that continues'}           | ${'up up up'}                              | ${['BUY']}
      ${'an uptrend after a neutral pause'}    | ${'up completed:1 neutral up'}             | ${['BUY']}
      ${'a downtrend when flat'}               | ${'down down'}                             | ${[]}
      ${'a downtrend while the BUY pends'}     | ${'up down down'}                          | ${['BUY']}
      ${'a downtrend once the BUY filled'}     | ${'up completed:1 down down'}              | ${['BUY', 'SELL']}
      ${'a BUY that fills during a downtrend'} | ${'up down completed:1 down'}              | ${['BUY', 'SELL']}
      ${'an uptrend while the SELL pends'}     | ${'up completed:1 down up up'}             | ${['BUY', 'SELL']}
      ${'an uptrend once the SELL filled'}     | ${'up completed:1 down completed:2 up'}    | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL that fills during an uptrend'} | ${'up completed:1 down up completed:2 up'} | ${['BUY', 'SELL', 'BUY']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should log when not in an up or down trend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 1, symbol: 'BTC/USDT' },
      ); // Diff = 0
      expect(logs).toContainEqual({
        level: 'debug',
        message: 'We are currently not in an up or down trend: @ 10.00000000 (1.00000/0.00000)',
      });
    });
  });

  describe('order outcomes', () => {
    it.each`
      case                                                       | steps                                            | expectedSides
      ${'a BUY completed: long, it sells'}                       | ${'up completed:1 down'}                         | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next uptrend'}     | ${'up canceled:1 up neutral up down up'}         | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next uptrend'}      | ${'up errored:1 up neutral up down up'}          | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}                 | ${'up completed:1 down completed:2 up'}          | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next downtrend'} | ${'up completed:1 down canceled:2 down up down'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next downtrend'}  | ${'up completed:1 down errored:2 down up down'}  | ${['BUY', 'SELL', 'SELL']}
      ${'another order completed: still pending'}                | ${'up completed:unknown down up'}                | ${['BUY']}
      ${'another order canceled: still pending'}                 | ${'up canceled:unknown down up'}                 | ${['BUY']}
      ${'another order errored: still pending'}                  | ${'up errored:unknown down up'}                  | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('log', () => {
    it.each`
      smaRes       | demaRes      | expectedLogsLength
      ${undefined} | ${undefined} | ${0}
      ${1}         | ${undefined} | ${0}
      ${undefined} | ${2}         | ${0}
    `('should not log when results are missing (sma: $smaRes, dema: $demaRes)', ({ smaRes, demaRes, expectedLogsLength }) => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect(logs).toHaveLength(expectedLogsLength);
    });

    it('should log DEMA and SMA properties', () => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1.23456, symbol: 'BTC/USDT' },
        { results: 2.34567, symbol: 'BTC/USDT' },
      );
      expect(logs).toContainEqual({
        level: 'debug',
        message: 'Calculated DEMA and SMA properties for candle: DEMA: 1.23456 SMA: 2.34567',
      });
    });
  });
});
