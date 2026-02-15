import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { BalanceDetail } from '@models/portfolio.types';
import { debug, error, info, warning } from '@services/logger';
import { addMinutes } from 'date-fns';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tools } from './strategy.types';
import { StrategyManager } from './strategyManager';

const indicatorMocks = vi.hoisted(() => {
  const indicatorInstances: Array<{
    onNewCandle: ReturnType<typeof vi.fn>;
    getResult: ReturnType<typeof vi.fn>;
  }> = [];
  const IndicatorMock = vi.fn().mockImplementation((_parameters: unknown) => {
    const instance = {
      onNewCandle: vi.fn(),
      getResult: vi.fn().mockReturnValue('indicator-result'),
    };
    indicatorInstances.push(instance);
    return instance;
  });

  return { IndicatorMock, indicatorInstances };
});

vi.mock('@indicators/index', () => ({
  SMA: indicatorMocks.IndicatorMock,
  UNKNOWN: undefined,
}));

const strategyMocks = vi.hoisted(() => {
  class DummyStrategy {
    init = vi.fn();
    onEachTimeframeCandle = vi.fn();
    onTimeframeCandleAfterWarmup = vi.fn();
    onOrderCompleted = vi.fn();
    onOrderCanceled = vi.fn();
    onOrderErrored = vi.fn();
    log = vi.fn();
    end = vi.fn();
  }

  return { DummyStrategy, UnknownStrategy: undefined };
});

vi.mock('@strategies/index', () => strategyMocks);

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'db2254e3-c749-448c-b7b6-aa28831bbae7'),
}));

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getStrategy: vi.fn(() => ({ each: 1, wait: 0 })),
      getWatch: vi.fn(() => ({
        pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
      })),
    };
  });
  return { config: new Configuration() };
});

vi.mock('./debug/debugAdvice.startegy.ts', () => ({
  DebugAdvice: class {
    init = vi.fn();
    onEachTimeframeCandle = vi.fn();
    onTimeframeCandleAfterWarmup = vi.fn();
    onOrderCompleted = vi.fn();
    onOrderCanceled = vi.fn();
    onOrderErrored = vi.fn();
    log = vi.fn();
    end = vi.fn();
  },
  MissingStrategy: undefined,
}));

describe('StrategyManager', () => {
  let manager: StrategyManager;
  const defaultMarketData = new Map([['BTC/USDT', { amount: { min: 1 } }]]) as any;
  const candle = {
    start: 1000,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  } as any;

  const bucket: CandleBucket = new Map();
  bucket.set('BTC/USDT', candle);

  beforeEach(() => {
    manager = new StrategyManager(1);
    manager.setMarketData(defaultMarketData);
  });

  describe('createStrategy', () => {
    it('instantiates a built-in strategy', async () => {
      await manager.createStrategy('DummyStrategy');
      expect(manager['strategy']).toBeInstanceOf(strategyMocks.DummyStrategy);
    });

    it('loads a strategy from a custom path', async () => {
      const strategyPath = path.resolve(__dirname, './debug/debugAdvice.startegy.ts');
      await manager.createStrategy('DebugAdvice', strategyPath);
      const strategy: any = manager['strategy'];
      expect(strategy).toBeDefined();
      expect(strategy.constructor.name).toBe('DebugAdvice');
    });

    it('throws when built-in strategy is missing', async () => {
      await expect(manager.createStrategy('UnknownStrategy')).rejects.toThrow(GekkoError);
    });

    it('throws when external module does not expose the strategy', async () => {
      const strategyPath = path.resolve(__dirname, './debug/debugAdvice.startegy.ts');
      await expect(manager.createStrategy('MissingStrategy', strategyPath)).rejects.toThrow(GekkoError);
    });
  });

  describe('strategy events', () => {
    describe('onTimeFrameCandle', () => {
      it('initializes strategy once, processes indicators, and emits warmup completion', () => {
        const indicator = { onNewCandle: vi.fn(), getResult: vi.fn().mockReturnValue(42) };
        manager['indicators'].push({ indicator, symbol: 'BTC/USDT' } as any);
        const strategy = {
          init: vi.fn(),
          onEachTimeframeCandle: vi.fn(),
          log: vi.fn(),
          onTimeframeCandleAfterWarmup: vi.fn(),
        };
        manager['strategy'] = strategy as any;
        const warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);

        // 1st Candle: Warmup phase (age 0 -> 1)
        manager.onTimeFrameCandle(bucket);

        expect(strategy.init).toHaveBeenCalledTimes(1);
        const initArgs = strategy.init.mock.calls[0]?.[0];
        expect(initArgs.candle).toBe(bucket);
        expect(initArgs.portfolio).toBeInstanceOf(Map);
        expect(initArgs.portfolio.size).toBe(0);
        expect(initArgs.addIndicator).toBe(manager['addIndicator']);
        expect(initArgs.tools).toEqual({
          strategyParams: { each: 1, wait: 0 },
          marketData: defaultMarketData,
          createOrder: manager['createOrder'],
          cancelOrder: manager['cancelOrder'],
          log: manager['log'],
        });
        expect(indicator.onNewCandle).toHaveBeenCalledWith(candle);
        expect(indicator.getResult).toHaveBeenCalled();
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(1);

        const [params, indicatorResult] = strategy.onEachTimeframeCandle.mock.calls[0] as [any, number];
        expect(params.candle).toBe(bucket);
        expect(indicatorResult).toBe(42);

        // Log/AfterWarmup NOT called yet, as age was 0 during execution, now incremented to 1
        expect(strategy.log).not.toHaveBeenCalled();
        expect(strategy.onTimeframeCandleAfterWarmup).not.toHaveBeenCalled();
        expect(warmupListener).not.toHaveBeenCalled();

        // The implementation checks: `if (this.warmupPeriod === this.age)`.
        // Constructor sets warmupPeriod = 1.
        // First call: age 0. logic runs. at end: age becomes 1.
        // Wait, the implementation says:
        // if (this.warmupPeriod === this.age) emit
        // if (this.warmupPeriod <= this.age) log/afterWarmup
        // if (this.warmupPeriod >= this.age) age++

        // So:
        // Start: age = 0, warmup = 1.
        // Logic runs.
        // Check 1: 1 === 0 (false)
        // Check 2: 1 <= 0 (false)
        // Check 3: 1 >= 0 (true) -> age becomes 1.

        // 2nd Candle: Age = 1. Warmup = 1.

        // 2nd execution
        manager.onTimeFrameCandle(bucket);

        expect(strategy.init).toHaveBeenCalledTimes(1); // Only once

        // Check 1: 1 === 1 (true) -> emit
        expect(warmupListener).toHaveBeenCalledWith(bucket);

        // Check 2: 1 <= 1 (true) -> log/afterWarmup
        expect(strategy.log).toHaveBeenCalledTimes(1);
        expect(strategy.onTimeframeCandleAfterWarmup).toHaveBeenCalledTimes(1);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(2);

        // Check 3: 1 >= 1 (true) -> age becomes 2.
      });

      it('should handle indicators for symbols missing in bucket (e.g. multi-timeframe)', () => {
        const indicator = { onNewCandle: vi.fn(), getResult: vi.fn() };
        manager['indicators'].push({ indicator, symbol: 'ETH/USDT' } as any); // ETH not in bucket
        const strategy = { init: vi.fn(), onEachTimeframeCandle: vi.fn(), log: vi.fn(), onTimeframeCandleAfterWarmup: vi.fn() };
        manager['strategy'] = strategy as any;

        manager.onTimeFrameCandle(bucket); // Bucket only has BTC

        expect(indicator.onNewCandle).not.toHaveBeenCalled();
        expect(indicator.getResult).toHaveBeenCalled(); // Should still get result (e.g. previous)
      });
    });

    describe('onOrderComplete', () => {
      it('forwards completed orders to the strategy', () => {
        const strategy = { onOrderCompleted: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '1' } as any;
        const exchange = { price: 10 };
        manager['indicatorsResults'] = ['indicator'];

        manager.onOrderCompleted({ order, exchange } as any);

        expect(strategy.onOrderCompleted).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          'indicator',
        );
      });
    });

    describe('onOrderCanceled', () => {
      it('forwards canceled orders to the strategy', () => {
        const strategy = { onOrderCanceled: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '2' } as any;
        const exchange = { price: 11 };
        manager['indicatorsResults'] = ['indicator'];

        manager.onOrderCanceled({ order, exchange } as any);

        expect(strategy.onOrderCanceled).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          'indicator',
        );
      });
    });

    describe('onOrderErrored', () => {
      it('forwards errored orders to the strategy', () => {
        const strategy = { onOrderErrored: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '3' } as any;
        const exchange = { price: 12 };
        manager['indicatorsResults'] = ['indicator'];

        manager.onOrderErrored({ order, exchange } as any);

        expect(strategy.onOrderErrored).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          'indicator',
        );
      });
    });

    describe('onStrategyEnd', () => {
      it('ends the underlying strategy', () => {
        const strategy = { end: vi.fn() };
        manager['strategy'] = strategy as any;

        manager.onStrategyEnd();

        expect(strategy.end).toHaveBeenCalled();
      });
    });
  });

  describe('setters function', () => {
    describe('setPortfolio', () => {
      it('updates the portfolio reference used by tools', () => {
        const portfolio = new Map<any, BalanceDetail>();
        portfolio.set('BTC', { free: 2, used: 0, total: 2 });
        portfolio.set('USDT', { free: 3, used: 0, total: 3 });
        const strategy = {
          init: vi.fn(),
          onEachTimeframeCandle: vi.fn(),
          log: vi.fn(),
          onTimeframeCandleAfterWarmup: vi.fn(),
        };
        manager['strategy'] = strategy as any;

        manager.setPortfolio(portfolio);

        manager.onTimeFrameCandle(bucket);

        const params = strategy.onEachTimeframeCandle.mock.calls[0]?.[0];
        expect(params?.portfolio).toBe(portfolio);
      });
    });
    describe('setMarketData', () => {
      it('applies the provided market data to newly created tools', () => {
        const marketData = new Map([['BTC/USDT', { amount: { min: 0.1, max: 5 } }]]) as any;

        manager.setMarketData(marketData);

        const tools = manager['createTools']();
        expect(tools.marketData).toEqual(marketData);
      });
    });
  });

  describe('functions used in trader strategies', () => {
    describe('addIndicator', () => {
      it('registers indicator instances from the registry', () => {
        const indicator = manager['addIndicator']('SMA', 'BTC/USDT', { period: 10 });
        expect(indicatorMocks.IndicatorMock).toHaveBeenCalledWith({ period: 10 });
        expect(manager['indicators']).toContainEqual({ indicator, symbol: 'BTC/USDT' });
      });

      it('throws when indicator is unknown', () => {
        expect(() => manager['addIndicator']('UNKNOWN' as any, 'BTC/USDT', {})).toThrow(GekkoError);
      });
    });

    describe('createOrder', () => {
      it('createOrder emits the advice event', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        const order = { side: 'BUY', type: 'STICKY', quantity: 1, symbol: 'BTC/USDT' } as const;

        // Must set timestamp via candle first
        manager['currentTimestamp'] = new Date('2025-01-01T00:00:00.000Z').getTime();
        const timeBucket: CandleBucket = new Map();
        manager.onTimeFrameCandle(timeBucket);

        const id = manager['createOrder'](order);

        expect(id).toBe('db2254e3-c749-448c-b7b6-aa28831bbae7');
        expect(listener).toHaveBeenCalledWith({
          ...order,
          id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
          orderCreationDate: addMinutes(manager['currentTimestamp'], 1).getTime(),
        });
      });

      it('throws if no timestamp available', () => {
        manager['currentTimestamp'] = 0;
        const order = { side: 'BUY', type: 'STICKY', quantity: 1, symbol: 'BTC/USDT' } as const;
        expect(() => manager['createOrder'](order)).toThrow('No candle when relaying advice');
      });
    });

    describe('cancelOrder', () => {
      it('cancelOrder emits the cancel event', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_CANCEL_ORDER_EVENT, listener);

        manager['cancelOrder']('db2254e3-c749-448c-b7b6-aa28831bbae7');

        expect(listener).toHaveBeenCalledWith('db2254e3-c749-448c-b7b6-aa28831bbae7');
      });
    });

    describe('log', () => {
      it.each([
        { level: 'debug' as LogLevel, logger: debug },
        { level: 'info' as LogLevel, logger: info },
        { level: 'warn' as LogLevel, logger: warning },
      ])('calls $level logger', ({ level, logger }) => {
        manager['log'](level, 'message');
        expect(logger).toHaveBeenCalledWith('strategy', 'message');
      });

      it('calls error logger', () => {
        expect(() => manager['log']('error', 'message')).toThrow(GekkoError);
        expect(error).toHaveBeenCalledWith('strategy', 'message');
      });

      it('emits STRATEGY_INFO_EVENT with metadata', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_INFO_EVENT, listener);

        manager['log']('info', 'Something happened');

        expect(listener).toHaveBeenCalledWith({
          timestamp: manager['currentTimestamp'],
          level: 'info',
          tag: 'strategy',
          message: 'Something happened',
        });
      });
    });
  });

  describe('utils function', () => {
    describe('createTools', () => {
      it('builds a toolset wired with the candle, helpers, and manager state', () => {
        const tools = manager['createTools']();

        expect(tools).toStrictEqual({
          strategyParams: manager['strategyParams'],
          marketData: defaultMarketData,
          createOrder: manager['createOrder'],
          cancelOrder: manager['cancelOrder'],
          log: manager['log'],
        } as Tools<object>);
      });
    });

    describe('emitWarmupCompletedEvent', () => {
      it('should log warmup completion', () => {
        manager['emitWarmupCompletedEvent'](bucket);

        expect(info).toHaveBeenCalledWith('strategy', expect.stringContaining('Strategy warmup done'));
      });
      it('should emit the event with the candle payload', () => {
        const warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);

        manager['emitWarmupCompletedEvent'](bucket);

        expect(warmupListener).toHaveBeenCalledWith(bucket);
      });
    });
  });
});
