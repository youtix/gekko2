import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { LogLevel } from '@models/logLevel.types';
import { BalanceDetail } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { debug, error, info, warning } from '@services/logger';
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
      getWatch: vi.fn(() => ({ asset: 'BTC', currency: 'USDT' })),
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
  const defaultMarketData: MarketData = { amount: { min: 1 } };
  const candle = {
    start: 0,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  } as any;

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
    describe('onNewCandle', () => {
      it('initializes strategy once, processes indicators, and emits warmup completion', () => {
        const indicator = { onNewCandle: vi.fn(), getResult: vi.fn().mockReturnValue(42) };
        manager['indicators'].push(indicator as any);
        const strategy = {
          init: vi.fn(),
          onEachTimeframeCandle: vi.fn(),
          log: vi.fn(),
          onTimeframeCandleAfterWarmup: vi.fn(),
        };
        manager['strategy'] = strategy as any;
        const warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);

        manager.onTimeFrameCandle(candle);

        expect(strategy.init).toHaveBeenCalledTimes(1);
        const initArgs = strategy.init.mock.calls[0]?.[0];
        expect(initArgs.candle).toEqual(candle);
        expect(initArgs.portfolio).toBeInstanceOf(Map);
        expect(initArgs.portfolio.size).toBe(0); // Empty portfolio initially
        expect(initArgs.addIndicator).toBe(manager['addIndicator']);
        expect(initArgs.tools).toEqual({
          strategyParams: { each: 1, wait: 0 },
          marketData: defaultMarketData,
          createOrder: manager['createOrder'],
          cancelOrder: manager['cancelOrder'],
          log: manager['log'],
          pairs: [['BTC', 'USDT']],
        });
        expect(indicator.onNewCandle).toHaveBeenCalledWith(candle);
        expect(indicator.getResult).toHaveBeenCalled();
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(1);

        const [params, indicatorResult] = strategy.onEachTimeframeCandle.mock.calls[0] as [any, number];
        expect(params.candle).toEqual(candle);
        expect(params.portfolio).toBeInstanceOf(Map);
        expect(params.portfolio.size).toBe(0); // Empty portfolio initially
        expect(params.tools).toMatchObject({
          strategyParams: { each: 1, wait: 0 },
          marketData: defaultMarketData,
          createOrder: manager['createOrder'],
          cancelOrder: manager['cancelOrder'],
          log: manager['log'],
          pairs: [['BTC', 'USDT']],
        });
        expect(indicatorResult).toBe(42);
        expect(strategy.log).not.toHaveBeenCalled();
        expect(strategy.onTimeframeCandleAfterWarmup).not.toHaveBeenCalled();
        expect(warmupListener).not.toHaveBeenCalled();

        manager.onTimeFrameCandle(candle);

        expect(strategy.init).toHaveBeenCalledTimes(1);
        expect(warmupListener).toHaveBeenCalledWith(candle);
        expect(info).toHaveBeenCalledWith(
          'strategy',
          expect.stringContaining('Strategy warmup done ! Sending first candle (1970-01-01T00:00:00.000Z) to strategy'),
        );
        expect(strategy.log).toHaveBeenCalledTimes(1);
        expect(strategy.onTimeframeCandleAfterWarmup).toHaveBeenCalledTimes(1);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(2);
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
            tools: {
              strategyParams: { each: 1, wait: 0 },
              marketData: defaultMarketData,
              createOrder: manager['createOrder'],
              cancelOrder: manager['cancelOrder'],
              log: manager['log'],
              pairs: [['BTC', 'USDT']],
            },
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
            tools: {
              strategyParams: { each: 1, wait: 0 },
              marketData: defaultMarketData,
              createOrder: manager['createOrder'],
              cancelOrder: manager['cancelOrder'],
              log: manager['log'],
              pairs: [['BTC', 'USDT']],
            },
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
            tools: {
              strategyParams: { each: 1, wait: 0 },
              marketData: defaultMarketData,
              createOrder: manager['createOrder'],
              cancelOrder: manager['cancelOrder'],
              log: manager['log'],
              pairs: [['BTC', 'USDT']],
            },
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
        const portfolio = new Map<string, BalanceDetail>();
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

        manager.onTimeFrameCandle(candle);

        const params = strategy.onEachTimeframeCandle.mock.calls[0]?.[0];
        expect(params?.portfolio).toBe(portfolio);
      });
    });
    describe('setMarketData', () => {
      it('applies the provided market data to newly created tools', () => {
        const marketData: MarketData = { amount: { min: 0.1, max: 5 } };

        manager.setMarketData(marketData);

        const tools = manager['createTools']();
        expect(tools.marketData).toEqual(marketData);
      });
    });
  });

  describe('functions used in trader strategies', () => {
    describe('addIndicator', () => {
      it('registers indicator instances from the registry', () => {
        const indicator = manager['addIndicator']('SMA', { period: 10 });
        expect(indicatorMocks.IndicatorMock).toHaveBeenCalledWith({ period: 10 });
        expect(manager['indicators']).toContain(indicator);
      });

      it('throws when indicator is unknown', () => {
        expect(() => manager['addIndicator']('UNKNOWN' as any, {})).toThrow(GekkoError);
      });
    });

    describe('createOrder', () => {
      it('createOrder emits the advice event', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        const order = { side: 'BUY', type: 'STICKY', quantity: 1 } as const;
        const candleStart = Date.UTC(2024, 0, 1, 0, 0, 0);
        manager.onOneMinuteCandle({ start: candleStart } as any);

        const id = manager['createOrder'](order);

        expect(id).toBe('db2254e3-c749-448c-b7b6-aa28831bbae7');
        expect(listener).toHaveBeenCalledWith({
          ...order,
          id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
          orderCreationDate: Date.UTC(2024, 0, 1, 0, 1, 0),
        });
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
        vi.useFakeTimers();
        try {
          const timestamp = new Date('2024-01-01T00:00:00.000Z');
          vi.setSystemTime(timestamp);
          const listener = vi.fn();
          manager.on(STRATEGY_INFO_EVENT, listener);

          manager['log']('info', 'Something happened');

          expect(listener).toHaveBeenCalledWith({
            timestamp: timestamp.getTime(),
            level: 'info',
            tag: 'strategy',
            message: 'Something happened',
          });
        } finally {
          vi.useRealTimers();
        }
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
          pairs: [['BTC', 'USDT']],
        } as Tools<object>);
      });

      it('throws when market data are unset before creating tools', () => {
        manager.setMarketData(null);

        expect(() => manager['createTools']()).toThrow(GekkoError);
      });
    });
    describe('emitWarmupCompletedEvent', () => {
      it('should log warmup completion', () => {
        manager['emitWarmupCompletedEvent'](candle);

        expect(info).toHaveBeenCalledWith(
          'strategy',
          expect.stringContaining('Strategy warmup done ! Sending first candle (1970-01-01T00:00:00.000Z) to strategy'),
        );
      });
      it('should emit the event with the candle payload', () => {
        const warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);

        manager['emitWarmupCompletedEvent'](candle);

        expect(warmupListener).toHaveBeenCalledWith(candle);
      });
    });
  });
});
