import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TMA } from './tma.strategy';
import { TMAStrategyParams } from './tma.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({ short: 3, medium: 5, long: 8 }));
  return { config: new Configuration() };
});

const symbol = 'BTC/USDT';

describe('TMA Strategy', () => {
  let strategy: TMA;
  let advices: AdviceOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  beforeEach(() => {
    strategy = new TMA();
    advices = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { short: 3, medium: 5, long: 8, src: 'close' },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<TMAStrategyParams>);
  });

  describe('init', () => {
    it('should add three SMA indicators with correct periods and src', () => {
      expect(addIndicator).toHaveBeenNthCalledWith(1, 'SMA', symbol, { period: 3, src: 'close' });
      expect(addIndicator).toHaveBeenNthCalledWith(2, 'SMA', symbol, { period: 5, src: 'close' });
      expect(addIndicator).toHaveBeenNthCalledWith(3, 'SMA', symbol, { period: 8, src: 'close' });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new TMA();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
        { results: 10, symbol },
        { results: 5, symbol },
        { results: 2, symbol },
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      shortRes     | mediumRes    | longRes
      ${undefined} | ${5}         | ${2}
      ${10}        | ${undefined} | ${2}
      ${10}        | ${5}         | ${undefined}
      ${'invalid'} | ${5}         | ${2}
    `(
      'should do nothing when results are invalid (short: $shortRes, med: $mediumRes, long: $longRes)',
      ({ shortRes, mediumRes, longRes }) => {
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
          { results: shortRes, symbol },
          { results: mediumRes, symbol },
          { results: longRes, symbol },
        );
        expect(advices).toHaveLength(0);
      },
    );

    it.each`
      shortRes | mediumRes | longRes | expectedSide | expectedLogRegex
      ${10}    | ${5}      | ${2}    | ${'BUY'}     | ${/long advice due to detected uptrend: 10\/5\/2/}
      ${3}     | ${5}      | ${2}    | ${'SELL'}    | ${/short advice due to detected downtrend: 3\/5\/2/}
      ${5}     | ${3}      | ${7}    | ${'SELL'}    | ${/short advice due to detected downtrend: 5\/3\/7/}
    `(
      'should emit $expectedSide advice when short=$shortRes, med=$mediumRes, long=$longRes',
      ({ shortRes, mediumRes, longRes, expectedSide, expectedLogRegex }) => {
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
          { results: shortRes, symbol },
          { results: mediumRes, symbol },
          { results: longRes, symbol },
        );
        expect(advices).toEqual([{ type: 'STICKY', side: expectedSide, amount: 1, symbol }]);
        expect(logs).toContainEqual(expect.objectContaining({ message: expect.stringMatching(expectedLogRegex) }));
      },
    );

    it('should not emit advice and log debug when no clear trend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
        { results: 5, symbol },
        { results: 5, symbol },
        { results: 5, symbol },
      );
      expect(advices).toHaveLength(0);
      expect(logs).toContainEqual({ level: 'debug', message: 'No clear trend detected: 5/5/5' });
    });
  });
});
