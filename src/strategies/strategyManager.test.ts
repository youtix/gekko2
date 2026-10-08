import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '@constants/event.const';
import { ONE_MINUTE } from '@constants/time.const';
import { ApplicationStopError } from '@errors/applicationStop.error';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder, StrategyOrder, TrailingConfig } from '@models/advice.types';
import { CandleBucket, ExchangeEvent, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { OrderSide } from '@models/order.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { MarketData } from '@services/exchange/exchange.types';
import { debug, error, info, isLevelEnabled, warning } from '@services/logger';
import { randomUUID, UUID } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AddIndicatorFn, IndicatorResults, InitParams, OnCandleEventParams, Tools } from './strategy.types';
import { StrategyManager } from './strategyManager';
import { TrailingStopState } from './trailingStopManager.types';

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

const strategyMocks = await vi.hoisted(async () => {
  const { z } = await import('zod');

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

  // Declares its parameters, as every built-in strategy does: a period, and a source that defaults to close
  class SchemaStrategy {
    static schema = z.strictObject({ period: z.number(), src: z.enum(['open', 'close']).default('close') });
    init = vi.fn();
  }

  return { DummyStrategy, SchemaStrategy, UnknownStrategy: undefined };
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
  isLevelEnabled: vi.fn(),
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

/** A text in single quotes, as util.inspect shows a string */
const quoted = (text: string) => `'${text}'`;

/** The levels LogLevel names, the most severe first: winston prints those down to GEKKO_LOG_LEVEL */
const LEVELS_BY_SEVERITY: LogLevel[] = ['error', 'warn', 'info', 'debug'];

/** Has the logger's isLevelEnabled answer as it does with this GEKKO_LOG_LEVEL */
const setGekkoLogLevel = (gekkoLogLevel: LogLevel) =>
  vi.mocked(isLevelEnabled).mockImplementation(level => LEVELS_BY_SEVERITY.indexOf(level) <= LEVELS_BY_SEVERITY.indexOf(gekkoLogLevel));

vi.mock('./debug/debugAdvice.strategy.ts', () => ({
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
  // The same class as the registry's, loaded from a strategyPath
  SchemaStrategy: strategyMocks.SchemaStrategy,
  MissingStrategy: undefined,
}));

describe('StrategyManager', () => {
  let manager: StrategyManager;
  const defaultMarketData = new Map([['BTC/USDT', { amount: { min: 1 } }]]) as any;
  /** The market data of two watched pairs, as the TradingAdvisor sets it when watch.assets holds BTC and ETH */
  const twoPairsMarketData = new Map<TradingPair, MarketData>([
    ['BTC/USDT', { amount: { min: 0.0001 } }],
    ['ETH/USDT', { amount: { min: 0.001 } }],
  ]);
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

  /** Ends the warmup of the manager (one candle) as the TradingAdvisor would: the minute, then the 1m candle it completes, twice */
  const completeWarmup = () => {
    for (let candleNumber = 1; candleNumber <= 2; candleNumber++) {
      manager.onOneMinuteBucket(bucket);
      manager.onTimeFrameCandle(bucket);
    }
  };

  beforeEach(() => {
    setGekkoLogLevel('error'); // Its default
    manager = new StrategyManager(1);
    manager.setMarketData(defaultMarketData);
  });

  describe('Constructor', () => {
    it('initializes with default empty config if no strategy config exists', () => {
      vi.mocked(config.getStrategy).mockReturnValueOnce(undefined as any);
      const m = new StrategyManager(1);
      expect(m['strategyParams']).toEqual({});
    });
  });

  describe('createStrategy', () => {
    it('instantiates a built-in strategy', async () => {
      await manager.createStrategy('DummyStrategy');
      expect(manager['strategy']).toBeInstanceOf(strategyMocks.DummyStrategy);
    });

    it('loads a strategy from a custom path', async () => {
      const strategyPath = path.resolve(__dirname, './debug/debugAdvice.strategy.ts');
      await manager.createStrategy('DebugAdvice', strategyPath);
      const strategy: any = manager['strategy'];
      expect(strategy).toBeDefined();
      expect(strategy.constructor.name).toBe('DebugAdvice');
    });

    it('loads a strategy from an absolute custom path directly', async () => {
      const absolutePath = path.resolve(__dirname, './debug/debugAdvice.strategy.ts');
      await manager.createStrategy('DebugAdvice', absolutePath);
      expect(manager['strategy']).toBeDefined();
    });

    it('throws when built-in strategy is missing', async () => {
      await expect(manager.createStrategy('UnknownStrategy')).rejects.toThrow(GekkoError);
    });

    it('throws when external module does not expose the strategy', async () => {
      const strategyPath = path.resolve(__dirname, './debug/debugAdvice.strategy.ts');
      await expect(manager.createStrategy('MissingStrategy', strategyPath)).rejects.toThrow(GekkoError);
    });

    describe.each`
      origin               | strategyPath
      ${'the registry'}    | ${undefined}
      ${'a strategy path'} | ${path.resolve(__dirname, './debug/debugAdvice.strategy.ts')}
    `('of a class from $origin that declares a schema', ({ strategyPath }) => {
      describe('when the strategy block is valid', () => {
        beforeEach(async () => {
          vi.mocked(config.getStrategy).mockReturnValue({ name: 'SchemaStrategy', period: 14 });
          manager = new StrategyManager(1);
          await manager.createStrategy('SchemaStrategy', strategyPath);
          manager.onOneMinuteBucket(bucket); // Runs init
        });

        it('gives the strategy the output of its schema: the block without name, defaults applied', () => {
          const strategy: any = manager['strategy'];
          expect(strategy.init.mock.calls[0][0].tools.strategyParams).toEqual({ period: 14, src: 'close' });
        });

        it('keeps the parsed block as its own parameters', () => {
          expect(manager['strategyParams']).toBe(manager['tools'].strategyParams);
        });

        it('does not say that the parameters are not validated', () => {
          expect(info).not.toHaveBeenCalled();
        });
      });

      describe.each`
        problem                                      | block                                                 | issues
        ${'a key of the block is unknown'}           | ${{ name: 'SchemaStrategy', period: 14, peroid: 14 }} | ${'✖ Unrecognized key: "peroid"'}
        ${'a parameter is missing'}                  | ${{ name: 'SchemaStrategy', src: 'open' }}            | ${'✖ Invalid input: expected number, received undefined\n  → at period'}
        ${'a number is quoted'}                      | ${{ name: 'SchemaStrategy', period: '14' }}           | ${'✖ Invalid input: expected number, received string\n  → at period'}
        ${'the configuration has no strategy block'} | ${undefined}                                          | ${'✖ Invalid input: expected number, received undefined\n  → at period'}
      `('when $problem', ({ block, issues }) => {
        beforeEach(() => {
          vi.mocked(config.getStrategy).mockReturnValue(block);
          manager = new StrategyManager(1);
        });

        it('refuses the strategy with a GekkoError', async () => {
          await expect(manager.createStrategy('SchemaStrategy', strategyPath)).rejects.toBeInstanceOf(GekkoError);
        });

        it('names the strategy, then gives each problem with the path of its parameter', async () => {
          await expect(manager.createStrategy('SchemaStrategy', strategyPath)).rejects.toHaveProperty(
            'message',
            `[TRADING ADVISOR] Invalid parameters for strategy SchemaStrategy (strategy block):\n${issues}`,
          );
        });

        it('does not create the strategy', async () => {
          await manager.createStrategy('SchemaStrategy', strategyPath).catch(() => undefined);
          expect(manager['strategy']).toBeUndefined();
        });
      });
    });

    describe('of a class that declares no schema', () => {
      beforeEach(async () => {
        vi.mocked(config.getStrategy).mockReturnValue({ name: 'DummyStrategy', each: 1, wait: 0 });
        manager = new StrategyManager(1);
        await manager.createStrategy('DummyStrategy');
        manager.onOneMinuteBucket(bucket); // Runs init
      });

      it('gives the strategy the whole block, name included', () => {
        const strategy: any = manager['strategy'];
        expect(strategy.init.mock.calls[0][0].tools.strategyParams).toEqual({ name: 'DummyStrategy', each: 1, wait: 0 });
      });

      it('says once, at info level, that its parameters are not validated', () => {
        expect(vi.mocked(info).mock.calls).toEqual([
          ['trading advisor', 'Strategy DummyStrategy declares no schema: its parameters (the strategy block) are not validated'],
        ]);
      });
    });
  });

  describe('strategy events', () => {
    describe('onOneMinuteBucket', () => {
      it('updates time and trailing stop manager', () => {
        const updateSpy = vi.spyOn(manager['trailingStopManager'], 'update');
        // Add second candle to avoid reference identity check issues if needed
        const secondCandle = { ...candle, start: 1000 };
        const minBucket = new Map([['BTC/USDT', secondCandle]]) as any;
        manager.onOneMinuteBucket(minBucket);

        expect(manager['currentTimestamp']).toBe(new Date(1000 + 60000).getTime());
        expect(updateSpy).toHaveBeenCalledWith(minBucket);
      });

      // init ran on the first timeframe candle: up to a day after start-up on 1d without warmup (a month on 1M), which is when an
      // indicator misspelt there, or a parameter its checks refused, stopped the bot
      describe('init, on the first one-minute bucket', () => {
        const ETH_CANDLE = { ...candle, open: 3000, high: 3010, low: 2990, close: 3005 };
        /** The first minute of the two pairs watched here, a new bucket each time */
        const firstMinute = (): CandleBucket =>
          new Map([
            ['BTC/USDT', { ...candle }],
            ['ETH/USDT', { ...ETH_CANDLE }],
          ]);
        let strategy: { init: Mock<(params: InitParams<object>) => void>; onEachTimeframeCandle: Mock };

        /** What init was given */
        const initParams = () => strategy.init.mock.calls[0][0];

        beforeEach(() => {
          manager.setMarketData(twoPairsMarketData);
          strategy = { init: vi.fn(), onEachTimeframeCandle: vi.fn() };
          manager['strategy'] = strategy as any;
        });

        describe('when that bucket comes', () => {
          beforeEach(() => {
            manager.onOneMinuteBucket(firstMinute());
          });

          it('runs init', () => {
            expect(strategy.init).toHaveBeenCalledOnce();
          });

          it('gives init a candle of every pair of the bucket, in its order', () => {
            expect([...initParams().candle.keys()]).toEqual(['BTC/USDT', 'ETH/USDT']);
          });

          it('gives init the candles of that minute', () => {
            expect(initParams().candle).toEqual(firstMinute());
          });

          it('gives init the tools every candle hook gets', () => {
            expect(initParams().tools).toBe(manager['tools']);
          });

          it('gives init addIndicator', () => {
            expect(initParams().addIndicator).toBe(manager['addIndicator']);
          });
        });

        it('gives init the portfolio received before it', () => {
          const portfolio: Portfolio = new Map([['USDT', { free: 1000, used: 0, total: 1000 }]]);
          manager.onPortfolioChange(portfolio);
          manager.onOneMinuteBucket(firstMinute());
          expect(initParams().portfolio).toEqual(portfolio);
        });

        // The clock is set first: what init logs is dated with the end of its minute, as every line of that minute is
        it('dates what init logs with the end of its minute', () => {
          const listener = vi.fn();
          manager.on(STRATEGY_INFO_EVENT, listener);
          strategy.init.mockImplementation(({ tools }) => tools.log('info', 'Trading BTC/USDT'));
          manager.onOneMinuteBucket(firstMinute());
          expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ timestamp: candle.start + ONE_MINUTE }));
        });

        it('runs init once, not again on the minutes and the timeframe candles after it', () => {
          completeWarmup();
          expect(strategy.init).toHaveBeenCalledOnce();
        });

        it('keeps the indicators init registers', () => {
          strategy.init.mockImplementation(({ addIndicator }) => addIndicator('SMA', 'ETH/USDT', { period: 10 }));
          manager.onOneMinuteBucket(firstMinute());
          expect(manager['indicators']).toEqual([{ indicator: indicatorMocks.IndicatorMock.mock.instances[0], symbol: 'ETH/USDT' }]);
        });

        describe('then on the first timeframe candle', () => {
          const TIMEFRAME_ETH_CANDLE = { ...ETH_CANDLE, high: 3100, close: 3050, volume: 5 };
          let sma: { onNewCandle: Mock; getResult: Mock };

          beforeEach(() => {
            sma = { onNewCandle: vi.fn(), getResult: vi.fn(() => 42) };
            indicatorMocks.IndicatorMock.mockImplementation(function () {
              return sma;
            });
            strategy.init.mockImplementation(({ addIndicator }) => addIndicator('SMA', 'ETH/USDT', { period: 10 }));
            manager.onOneMinuteBucket(firstMinute());
            manager.onTimeFrameCandle(
              new Map([
                ['BTC/USDT', candle],
                ['ETH/USDT', TIMEFRAME_ETH_CANDLE],
              ]),
            );
          });

          it('feeds the indicators init registered that candle', () => {
            expect(sma.onNewCandle).toHaveBeenCalledExactlyOnceWith(TIMEFRAME_ETH_CANDLE);
          });

          it('gives the hooks of that candle their results', () => {
            expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.anything(), { results: 42, symbol: 'ETH/USDT' });
          });
        });
      });
    });

    describe('onTimeFrameCandle', () => {
      it('runs no init: the first one-minute bucket does', () => {
        const strategy = { init: vi.fn() };
        manager['strategy'] = strategy as any;
        manager.onTimeFrameCandle(bucket);
        expect(strategy.init).not.toHaveBeenCalled();
      });

      it('processes indicators, and emits warmup completion', () => {
        const indicator = { onNewCandle: vi.fn(), getResult: vi.fn().mockReturnValue(42) };
        manager['indicators'].push({ indicator, symbol: 'BTC/USDT' } as any);
        const strategy = {
          onEachTimeframeCandle: vi.fn(),
          log: vi.fn(),
          onTimeframeCandleAfterWarmup: vi.fn(),
        };
        manager['strategy'] = strategy as any;
        const warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);

        // 1st Candle: Warmup phase (age 0 -> 1)
        manager.onTimeFrameCandle(bucket);

        expect(indicator.onNewCandle).toHaveBeenCalledWith(candle);
        expect(indicator.getResult).toHaveBeenCalled();
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(1);

        const [params, indicatorResult] = strategy.onEachTimeframeCandle.mock.calls[0] as [any, any];
        expect(params.candle).toEqual(bucket);
        expect(indicatorResult).toEqual({ results: 42, symbol: 'BTC/USDT' });

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

        // Check 1: 1 === 1 (true) -> emit
        expect(warmupListener).toHaveBeenCalledWith(bucket);

        // Check 2: 1 <= 1 (true) -> log/afterWarmup
        expect(strategy.log).toHaveBeenCalledTimes(1);
        expect(strategy.onTimeframeCandleAfterWarmup).toHaveBeenCalledTimes(1);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(2);

        // Check 3: 1 >= 1 (true) -> age becomes 2.
      });

      it('does not increment age if warmup phase is not reached', () => {
        const customManager = new StrategyManager(5);
        customManager.onTimeFrameCandle(bucket);
        // Age starts at 0, warmup is 5.
        // So 5 > 0, age is bumped to 1.
        expect(customManager['age']).toBe(1);
      });

      // An indicator is on a watched pair (addIndicator refuses any other), and a timeframe bucket holds a candle of every watched pair
      it('feeds each indicator the candle of its own pair', () => {
        const ethCandle = { ...candle, open: 3000, high: 3010, low: 2990, close: 3005 };
        const btcIndicator = { onNewCandle: vi.fn(), getResult: vi.fn() };
        const ethIndicator = { onNewCandle: vi.fn(), getResult: vi.fn() };
        manager['indicators'].push(
          { indicator: btcIndicator, symbol: 'BTC/USDT' } as any,
          { indicator: ethIndicator, symbol: 'ETH/USDT' } as any,
        );

        manager.onTimeFrameCandle(
          new Map([
            ['BTC/USDT', candle],
            ['ETH/USDT', ethCandle],
          ]),
        );

        expect(ethIndicator.onNewCandle).toHaveBeenCalledExactlyOnceWith(ethCandle);
      });
    });

    describe('onOrderComplete', () => {
      it('forwards completed orders to the strategy', () => {
        const strategy = { onOrderCompleted: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '1' } as any;
        const exchange = { price: 10 };
        manager['indicatorsResults'] = [{ results: 'indicator', symbol: 'BTC/USDT' }];

        manager.onOrderCompleted({ order, exchange } as any);

        expect(strategy.onOrderCompleted).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          { results: 'indicator', symbol: 'BTC/USDT' },
        );
      });

      it('adds pending trailing stop to trailing stop manager', () => {
        const order = { id: '1', symbol: 'BTC/USDT', amount: 1, orderCreationDate: 123 } as any;
        const trailing = { percentage: 2 };
        manager['pendingTrailingStops'].set(order.id, trailing);
        const addOrderSpy = vi.spyOn(manager['trailingStopManager'], 'addOrder');

        manager.onOrderCompleted({ order, exchange: {} } as any);

        expect(addOrderSpy).toHaveBeenCalledWith({
          id: order.id,
          symbol: order.symbol,
          amount: order.amount,
          trailing: trailing,
          createdAt: order.orderCreationDate,
        });
        expect(manager['pendingTrailingStops'].has(order.id)).toBe(false);
      });
    });

    describe('onOrderCanceled', () => {
      it('forwards canceled orders to the strategy', () => {
        const strategy = { onOrderCanceled: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '2' } as any;
        const exchange = { price: 11 };
        manager['indicatorsResults'] = [{ results: 'indicator', symbol: 'BTC/USDT' }];

        manager.onOrderCanceled({ order, exchange } as any);

        expect(strategy.onOrderCanceled).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          { results: 'indicator', symbol: 'BTC/USDT' },
        );
      });
    });

    describe('onOrderErrored', () => {
      it('forwards errored orders to the strategy', () => {
        const strategy = { onOrderErrored: vi.fn() };
        manager['strategy'] = strategy as any;
        const order = { id: '3' } as any;
        const exchange = { price: 12 };
        manager['indicatorsResults'] = [{ results: 'indicator', symbol: 'BTC/USDT' }];

        manager.onOrderErrored({ order, exchange } as any);

        expect(strategy.onOrderErrored).toHaveBeenCalledWith(
          {
            order,
            exchange,
            tools: expect.objectContaining({ strategyParams: { each: 1, wait: 0 } }),
          },
          { results: 'indicator', symbol: 'BTC/USDT' },
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

      it('logs warning if pending orders present', () => {
        vi.spyOn(manager['trailingStopManager'], 'getOrders').mockReturnValue(
          new Map([['db2254e3-c749-448c-b7b6-aa28831bbae7', {} as any]]),
        );
        manager.onStrategyEnd();
        expect(warning).toHaveBeenCalledWith('strategy', 'Strategy ended with 1 active trailing stop(s) that never triggered.');
      });

      // The warmup is over with candle warmupPeriod + 1, the first the strategy can trade on. A backtest too short for it used to end
      // normally, without a trade and without a word about the warmup.
      describe.each`
        warmupPeriod | candleCount | counts
        ${3}         | ${0}        | ${'0 timeframe candle(s) processed, 4 needed (warmup.candleCount: 3, then one to trade on)'}
        ${3}         | ${3}        | ${'3 timeframe candle(s) processed, 4 needed (warmup.candleCount: 3, then one to trade on)'}
        ${0}         | ${0}        | ${'0 timeframe candle(s) processed, 1 needed (warmup.candleCount: 0, then one to trade on)'}
      `(
        'when the run ends after $candleCount timeframe candles, with a warmup of $warmupPeriod',
        ({ warmupPeriod, candleCount, counts }) => {
          let target: StrategyManager;

          beforeEach(() => {
            target = new StrategyManager(warmupPeriod);
            for (let candleNumber = 1; candleNumber <= candleCount; candleNumber++) {
              target.onOneMinuteBucket(bucket);
              target.onTimeFrameCandle(bucket);
            }
          });

          it('says at error level that the strategy never traded, with the candles processed and needed', () => {
            target.onStrategyEnd();
            expect(error).toHaveBeenCalledExactlyOnceWith(
              'strategy',
              `Strategy ended before its warmup was over, so it never traded: ${counts}`,
            );
          });

          it('does not throw', () => {
            expect(() => target.onStrategyEnd()).not.toThrow();
          });
        },
      );

      it.each`
        warmupPeriod | candleCount
        ${3}         | ${4}
        ${3}         | ${6}
        ${0}         | ${1}
      `(
        'says nothing at error level when the run ends after $candleCount timeframe candles, with a warmup of $warmupPeriod',
        ({ warmupPeriod, candleCount }) => {
          const target = new StrategyManager(warmupPeriod);
          for (let candleNumber = 1; candleNumber <= candleCount; candleNumber++) {
            target.onOneMinuteBucket(bucket);
            target.onTimeFrameCandle(bucket);
          }
          target.onStrategyEnd();
          expect(error).not.toHaveBeenCalled();
        },
      );
    });

    describe('Circuit Breaker (consecutiveErrors)', () => {
      const order = { id: '3' } as any;
      const exchange = { price: 12 } as any;

      it('should increment consecutive errors on order errored and throw ApplicationStopError when limit reached', () => {
        // First 4 errors should not throw
        for (let i = 0; i < 4; i++) {
          expect(() => manager.onOrderErrored({ order, exchange })).not.toThrow();
        }
        // 5th error should throw ApplicationStopError
        expect(() => manager.onOrderErrored({ order, exchange })).toThrowError(ApplicationStopError);
        expect(() => manager.onOrderErrored({ order, exchange })).toThrowError('Max consecutive order errors reached (5)');
      });

      it('should reset consecutive errors on order completed', () => {
        expect(() => manager.onOrderErrored({ order, exchange })).not.toThrow();
        manager.onOrderCompleted({ order, exchange });

        // Next 4 errors should not throw
        for (let i = 0; i < 4; i++) {
          expect(() => manager.onOrderErrored({ order, exchange })).not.toThrow();
        }
        // 5th throws
        expect(() => manager.onOrderErrored({ order, exchange })).toThrowError(ApplicationStopError);
      });

      it('should reset consecutive errors on order canceled', () => {
        expect(() => manager.onOrderErrored({ order, exchange })).not.toThrow();
        manager.onOrderCanceled({ order, exchange });

        // Next 4 errors should not throw
        for (let i = 0; i < 4; i++) {
          expect(() => manager.onOrderErrored({ order, exchange })).not.toThrow();
        }
        // 5th throws
        expect(() => manager.onOrderErrored({ order, exchange })).toThrowError(ApplicationStopError);
      });

      it('should not throw if maxConsecutiveErrors is -1', () => {
        const customManager = new StrategyManager(1, -1);

        for (let i = 0; i < 10; i++) {
          expect(() => customManager.onOrderErrored({ order, exchange })).not.toThrow();
        }
      });

      // A breaker of two errors in a row: the first goes by, the second trips it. The second is the error of a BUY with a trailing stop,
      // created once the warmup (of no candle) was over.
      describe('on the error that trips it', () => {
        let strategy: { onOrderErrored: Mock };
        let target: StrategyManager;
        let buyId: UUID;
        let failure: unknown;

        /** Sends the two errors and returns what the second one throws */
        const tripBreaker = () => {
          target.onOrderErrored({ order: { id: 'a1fe5e32-0c1b-4f53-8a5e-3c1d2b7e9f00' }, exchange } as any);
          try {
            target.onOrderErrored({ order: { id: buyId }, exchange } as any);
          } catch (caught) {
            return caught;
          }
        };

        beforeEach(() => {
          strategy = { onOrderErrored: vi.fn() };
          target = new StrategyManager(0, 2);
          target.setMarketData(defaultMarketData);
          target['strategy'] = strategy as any;
          target.onOneMinuteBucket(bucket);
          target.onTimeFrameCandle(bucket);
          buyId = target['createOrder']({ symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          failure = undefined;
        });

        describe('when the strategy hears of it without failing', () => {
          beforeEach(() => {
            failure = tripBreaker();
          });

          it('stops the run with an ApplicationStopError', () => {
            expect(failure).toBeInstanceOf(ApplicationStopError);
          });

          it('tells the strategy of that error before it stops', () => {
            expect(strategy.onOrderErrored).toHaveBeenLastCalledWith(expect.objectContaining({ order: { id: buyId } }));
          });

          it('drops the trailing stop of that order before it stops', () => {
            expect(target['pendingTrailingStops'].has(buyId)).toBe(false);
          });
        });

        // The orderly stop prevails, as when two plugins fail on one bucket: a restart-on-failure supervisor leaves the bot stopped
        describe.each`
          kind              | thrown                                               | reason
          ${'a GekkoError'} | ${new GekkoError('strategy', 'Retry limit reached')} | ${'[STRATEGY] Retry limit reached'}
          ${'a string'}     | ${'Retry limit reached'}                             | ${quoted('Retry limit reached')}
        `('when the strategy throws $kind as it hears of it', ({ thrown, reason }) => {
          beforeEach(() => {
            strategy.onOrderErrored.mockImplementation(({ order }) => {
              if (order.id === buyId) throw thrown;
            });
            failure = tripBreaker();
          });

          it('stops the run with the ApplicationStopError all the same', () => {
            expect(failure).toBeInstanceOf(ApplicationStopError);
          });

          it('logs the failure of the strategy', () => {
            expect(error).toHaveBeenCalledExactlyOnceWith(
              'strategy',
              `The strategy's onOrderErrored failed on the error that trips the circuit breaker: ${reason}`,
            );
          });

          it('drops the trailing stop of that order all the same', () => {
            expect(target['pendingTrailingStops'].has(buyId)).toBe(false);
          });
        });

        it('lets a failure of the strategy through on an error that does not trip it', () => {
          const thrown = new GekkoError('strategy', 'Retry limit reached');
          strategy.onOrderErrored.mockImplementation(() => {
            throw thrown;
          });
          expect(() => target.onOrderErrored({ order: { id: buyId }, exchange } as any)).toThrow(thrown);
        });
      });
    });

    describe('TrailingStopManager Events', () => {
      it('forwards activation back to strategy', () => {
        const strategy = { onTrailingStopActivated: vi.fn(), onTrailingStopTriggered: vi.fn() };
        manager['strategy'] = strategy as any;
        const state = { symbol: 'BTC/USDT', amount: 2 };

        manager['onTrailingStopActivated'](state as any);

        expect(strategy.onTrailingStopActivated).toHaveBeenCalledWith(state, manager['tools']);
      });

      it('creates market order and forwards trigger back to strategy', () => {
        const strategy = { onTrailingStopTriggered: vi.fn() };
        manager['strategy'] = strategy as any;
        completeWarmup(); // Orders wait for it
        const state = { symbol: 'BTC/USDT', amount: 2 };

        const createOrderSpy = vi.spyOn(manager as any, 'createOrder');
        manager['onTrailingStopTriggered'](state as any);

        expect(createOrderSpy).toHaveBeenCalledWith({ symbol: 'BTC/USDT', side: 'SELL', type: 'MARKET', amount: 2 });
        // The id comes from randomUUID mock 'db2254e3-c749-448c-b7b6-aa28831bbae7'
        expect(strategy.onTrailingStopTriggered).toHaveBeenCalledWith(expect.any(String), state, manager['tools']);
      });

      // Given the state alone, these hooks could neither cancel a stop, log nor order unless the strategy had kept the tools of an
      // earlier hook. They come last, so that a hook written without them still fits.
      it.each`
        hook                         | notify
        ${'onTrailingStopActivated'} | ${(state: TrailingStopState) => manager['onTrailingStopActivated'](state)}
        ${'onTrailingStopTriggered'} | ${(state: TrailingStopState) => manager['onTrailingStopTriggered'](state)}
      `('gives $hook, as its last argument, the tools every other hook gets', ({ hook, notify }) => {
        const strategy = { onTrailingStopActivated: vi.fn(), onTrailingStopTriggered: vi.fn() };
        manager['strategy'] = strategy as any;
        completeWarmup(); // The trigger creates the SELL, and orders wait for it
        notify({ symbol: 'BTC/USDT', amount: 2 } as any);
        expect(strategy[hook as keyof typeof strategy].mock.lastCall?.at(-1)).toBe(manager['tools']);
      });
    });

    describe('trailing stop of a BUY, from its creation to its SELL', () => {
      const symbol = 'BTC/USDT';
      const orderCreationDate = 61000;
      const minute = (high: number, low: number): CandleBucket =>
        new Map([[symbol, { start: 120000, open: high, high, low, close: low, volume: 1 }]]);
      const completeBuy = (id: UUID, amount: number) =>
        manager.onOrderCompleted({
          order: {
            id,
            symbol,
            side: 'BUY',
            type: 'MARKET',
            amount,
            orderCreationDate,
            orderExecutionDate: 61000,
            effectivePrice: 50000,
            fee: 0,
          },
          exchange: { price: 50000, portfolio: new Map() },
        });
      let strategy: { onTrailingStopActivated: ReturnType<typeof vi.fn>; onTrailingStopTriggered: ReturnType<typeof vi.fn> };

      beforeEach(() => {
        strategy = { onTrailingStopActivated: vi.fn(), onTrailingStopTriggered: vi.fn() };
        manager['strategy'] = strategy as any;
        // The clock and the end of the warmup, which createOrder needs
        completeWarmup();
      });

      it('activates a stop without trigger as soon as its BUY completes', () => {
        const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
        completeBuy(id, 0.5);
        expect(strategy.onTrailingStopActivated).toHaveBeenCalledWith(
          {
            id,
            symbol,
            amount: 0.5,
            config: { percentage: 2 },
            status: 'active',
            highestPeak: 0,
            stopPrice: 0,
            activationPrice: undefined,
            createdAt: orderCreationDate,
          },
          manager['tools'],
        );
      });

      it('activates a stop without trigger once, not again when it starts trailing', () => {
        const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
        completeBuy(id, 0.5);
        manager.onOneMinuteBucket(minute(50000, 49500));
        expect(strategy.onTrailingStopActivated).toHaveBeenCalledOnce();
      });

      it('does not activate a stop with a trigger when its BUY completes', () => {
        const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2, trigger: 51000 } });
        completeBuy(id, 0.5);
        expect(strategy.onTrailingStopActivated).not.toHaveBeenCalled();
      });

      it('activates a stop with a trigger when a candle reaches it', () => {
        const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2, trigger: 51000 } });
        completeBuy(id, 0.5);
        manager.onOneMinuteBucket(minute(51000, 50500));
        expect(strategy.onTrailingStopActivated).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'active', highestPeak: 51000, stopPrice: 49980, activationPrice: 51000 }),
          manager['tools'],
        );
      });

      it('sells what an all-in BUY filled when its stop triggers', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
        completeBuy(id, 0.5);
        manager.onOneMinuteBucket(minute(50000, 48000));
        expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ symbol, side: 'SELL', type: 'MARKET', amount: 0.5 }));
      });

      // From then on the SELL is an order of the strategy's own, whose outcome comes back under the id it is relayed with: a strategy
      // that tracks its position adopts that id, or it stays long once the stop has sold everything
      describe('when its stop triggers', () => {
        const BUY_ID: UUID = '0b0b0b0b-0000-4000-8000-000000000001';
        const SELL_ID: UUID = '5e115e11-0000-4000-8000-000000000002';
        let listener: Mock;

        beforeEach(() => {
          vi.mocked(randomUUID).mockReturnValueOnce(BUY_ID).mockReturnValueOnce(SELL_ID);
          listener = vi.fn();
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
          manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          completeBuy(BUY_ID, 0.5);
          manager.onOneMinuteBucket(minute(50000, 48000));
        });

        it('gives onTrailingStopTriggered the id the SELL is relayed with', () => {
          expect(strategy.onTrailingStopTriggered.mock.lastCall?.[0]).toBe(listener.mock.lastCall?.[0].id);
        });

        it('gives onTrailingStopTriggered the id of the SELL, then the state of the stop, then the tools', () => {
          expect(strategy.onTrailingStopTriggered).toHaveBeenCalledExactlyOnceWith(
            SELL_ID,
            expect.objectContaining({ id: BUY_ID, amount: 0.5 }),
            manager['tools'],
          );
        });
      });

      // The strategy changes the object it gave createOrder before its BUY completes. Kept by reference, the stop armed was the one
      // changed: another stop than the one checked, or none, a percentage of 0 being refused at arming
      describe.each`
        change                        | update
        ${'sets its percentage to 5'} | ${(trailing: TrailingConfig) => (trailing.percentage = 5)}
        ${'sets its percentage to 0'} | ${(trailing: TrailingConfig) => (trailing.percentage = 0)}
        ${'adds a trigger of 60000'}  | ${(trailing: TrailingConfig) => (trailing.trigger = 60000)}
      `('when the strategy $change after createOrder, before its BUY completes', ({ update }) => {
        let id: UUID;

        beforeEach(() => {
          const trailing = { percentage: 2 };
          id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing });
          update(trailing);
          completeBuy(id, 0.5);
        });

        it('arms the stop createOrder checked', () => {
          expect(manager['trailingStopManager'].getOrders().get(id)?.config).toEqual({ percentage: 2 });
        });
      });

      // The strategy cancels the stop as it hears of its activation, with the tools that hook gets, then a candle goes below the stop
      // price (49000): with a trigger, the very candle that activates it; without one, the first candle after its BUY completed, which
      // activated it
      describe.each`
        kind                        | trailing
        ${'a stop with a trigger'}  | ${{ percentage: 2, trigger: 50000 }}
        ${'a stop without trigger'} | ${{ percentage: 2 }}
      `('when the strategy cancels $kind from onTrailingStopActivated', ({ trailing }) => {
        // The orders the strategy creates once its BUY is created
        const listener = vi.fn();

        beforeEach(() => {
          strategy.onTrailingStopActivated.mockImplementation(({ id }: TrailingStopState, tools: Tools<object>) =>
            tools.cancelTrailingOrder(id),
          );
          const id = manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing });
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
          completeBuy(id, 0.5);
          manager.onOneMinuteBucket(minute(50000, 48000));
        });

        it('sends no SELL', () => {
          expect(listener).not.toHaveBeenCalled();
        });

        it('does not tell the strategy the stop triggered', () => {
          expect(strategy.onTrailingStopTriggered).not.toHaveBeenCalled();
        });
      });

      // A stop outlived the position of its BUY once the strategy had sold it: it later sold a position the strategy opened afterwards
      // (the Trader capping its SELL to what was free) or, the strategy being flat, sent a SELL that was refused and counted towards the
      // circuit breaker
      describe('when the strategy sells on a pair', () => {
        const ETH: TradingPair = 'ETH/USDT';
        const ACTIVE_ID: UUID = 'ac71e000-0000-4000-8000-000000000001';
        const DORMANT_ID: UUID = 'd0e1a000-0000-4000-8000-000000000002';
        const ETH_ID: UUID = 'e7e70000-0000-4000-8000-000000000003';
        const PENDING_ID: UUID = 'be1d0000-0000-4000-8000-000000000004';
        const SELL_ID: UUID = '5e115e11-0000-4000-8000-000000000005';
        const STOP_SELL_ID: UUID = '5e115e11-0000-4000-8000-000000000006';
        const exchange = { price: 50000, portfolio: new Map() };

        /** Creates an order as the strategy does, createOrder drawing `id` for it */
        const create = (id: UUID, order: StrategyOrder) => {
          vi.mocked(randomUUID).mockReturnValueOnce(id);
          manager['createOrder'](order);
        };
        /** Reports the fill of the order `id` as the Trader does */
        const complete = (id: UUID, side: OrderSide, pair: TradingPair, amount: number) =>
          manager.onOrderCompleted({
            order: {
              id,
              symbol: pair,
              side,
              type: 'MARKET',
              amount,
              orderCreationDate,
              orderExecutionDate: 61000,
              effectivePrice: 50000,
              fee: 0,
            },
            exchange,
          });
        /** Reports the cancelation of the SELL `id` on BTC/USDT after part of it filled */
        const cancel = (id: UUID) =>
          manager.onOrderCanceled({
            order: {
              id,
              symbol,
              side: 'SELL',
              type: 'STICKY',
              amount: 1,
              filled: 0.4,
              remaining: 0.6,
              orderCreationDate,
              orderCancelationDate: 61000,
            },
            exchange,
          });
        /** Reports the error of the SELL `id` on BTC/USDT */
        const fail = (id: UUID) =>
          manager.onOrderErrored({
            order: {
              id,
              symbol,
              side: 'SELL',
              type: 'STICKY',
              amount: 1,
              reason: 'Insufficient balance',
              orderCreationDate,
              orderErrorDate: 61000,
            },
            exchange,
          });
        /** A BUY of 0.5 on `pair` asking for `trailing`, completed: its stop is armed */
        const armStop = (id: UUID, pair: TradingPair, trailing: TrailingConfig) => {
          create(id, { symbol: pair, side: 'BUY', type: 'MARKET', trailing });
          complete(id, 'BUY', pair, 0.5);
        };
        /** An all-in MARKET SELL the strategy creates on `pair`, completed */
        const sellAll = (pair: TradingPair) => {
          create(SELL_ID, { symbol: pair, side: 'SELL', type: 'MARKET' });
          complete(SELL_ID, 'SELL', pair, 1);
        };
        /** The stops armed, by the id of their BUY */
        const armedStops = () => [...manager['trailingStopManager'].getOrders().keys()];
        /** What the manager said at info level of the stops it canceled */
        const cancelLines = () =>
          vi.mocked(info).mock.calls.filter(([, message]) => typeof message === 'string' && message.startsWith('Trailing stop of BUY'));
        const cancelLine = (stopId: UUID) => [
          'strategy',
          `Trailing stop of BUY ${stopId} canceled: the strategy sold on BTC/USDT (SELL ${SELL_ID} completed), closing the position the stop protected`,
        ];

        // Both pairs watched: the strategy trades on each
        beforeEach(() => manager.setMarketData(twoPairsMarketData));

        // Two stops on the pair, one active (without trigger) and one dormant (its trigger not reached yet), and one on another pair
        describe('once a SELL it created completes there', () => {
          let listener: Mock;

          beforeEach(() => {
            armStop(ACTIVE_ID, symbol, { percentage: 2 });
            armStop(DORMANT_ID, symbol, { percentage: 2, trigger: 60000 });
            armStop(ETH_ID, ETH, { percentage: 2 });
            sellAll(symbol);
            listener = vi.fn();
            manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
          });

          it.each`
            stop                  | id
            ${'the active stop'}  | ${ACTIVE_ID}
            ${'the dormant stop'} | ${DORMANT_ID}
          `('cancels $stop of the pair', ({ id }) => {
            expect(armedStops()).not.toContain(id);
          });

          it('leaves the stop of another pair armed', () => {
            expect(armedStops()).toContain(ETH_ID);
          });

          it('says at info level which stops it canceled, and why, one line each', () => {
            expect(cancelLines()).toEqual([cancelLine(ACTIVE_ID), cancelLine(DORMANT_ID)]);
          });

          // A candle on which both would have triggered: the dormant one activated at its open
          it('sends no SELL when the price then falls through their stop prices', () => {
            manager.onOneMinuteBucket(minute(60000, 48000));
            expect(listener).not.toHaveBeenCalled();
          });
        });

        // The active stop triggers and the dormant one is not reached: the SELL of the stop sold what its own BUY filled
        describe('once the SELL of a stop completes there', () => {
          beforeEach(() => {
            armStop(ACTIVE_ID, symbol, { percentage: 2 });
            armStop(DORMANT_ID, symbol, { percentage: 2, trigger: 60000 });
            vi.mocked(randomUUID).mockReturnValueOnce(STOP_SELL_ID);
            manager.onOneMinuteBucket(minute(50000, 48000));
            complete(STOP_SELL_ID, 'SELL', symbol, 0.5);
          });

          it('leaves the other stop of the pair armed', () => {
            expect(armedStops()).toEqual([DORMANT_ID]);
          });

          it('says nothing of canceling a stop', () => {
            expect(cancelLines()).toEqual([]);
          });
        });

        // A LIMIT BUY below the market waits while the strategy sells its position: it opens a position after that SELL
        describe('once a SELL it created completes there while a BUY asking for a stop is pending', () => {
          beforeEach(() => {
            armStop(ACTIVE_ID, symbol, { percentage: 2 });
            create(PENDING_ID, { symbol, side: 'BUY', type: 'LIMIT', price: 49000, amount: 0.2, trailing: { percentage: 3 } });
            sellAll(symbol);
          });

          it('keeps the stop of that BUY', () => {
            expect(manager['pendingTrailingStops'].has(PENDING_ID)).toBe(true);
          });

          it('arms it when that BUY completes', () => {
            complete(PENDING_ID, 'BUY', symbol, 0.2);
            expect(armedStops()).toEqual([PENDING_ID]);
          });
        });

        // Ended without completing, the SELL left the position held, in part at least: the stop keeps protecting it
        it.each`
          outcome       | end
          ${'canceled'} | ${cancel}
          ${'errored'}  | ${fail}
        `('leaves the stop of the pair armed when a SELL it created is $outcome', ({ end }) => {
          armStop(ACTIVE_ID, symbol, { percentage: 2 });
          create(SELL_ID, { symbol, side: 'SELL', type: 'STICKY' });
          end(SELL_ID);
          expect(armedStops()).toEqual([ACTIVE_ID]);
        });

        // The stops still armed are canceled once the strategy has heard of its SELL: one it canceled itself then is not reported
        it('says nothing of a stop the strategy canceled itself as it heard of that SELL', () => {
          manager['strategy'] = {
            onOrderCompleted: ({ order, tools }: { order: { side: OrderSide }; tools: Tools<object> }) => {
              if (order.side === 'SELL') tools.cancelTrailingOrder(ACTIVE_ID);
            },
          } as any;
          armStop(ACTIVE_ID, symbol, { percentage: 2 });
          sellAll(symbol);
          expect(cancelLines()).toEqual([]);
        });

        // Told apart from the SELLs the strategy created until its outcome arrives, the SELL of a stop is then forgotten
        it.each`
          outcome        | end
          ${'completed'} | ${(id: UUID) => complete(id, 'SELL', symbol, 0.5)}
          ${'canceled'}  | ${cancel}
          ${'errored'}   | ${fail}
        `('forgets the SELL of a stop once it is $outcome', ({ end }) => {
          armStop(ACTIVE_ID, symbol, { percentage: 2 });
          vi.mocked(randomUUID).mockReturnValueOnce(STOP_SELL_ID);
          manager.onOneMinuteBucket(minute(50000, 48000));
          end(STOP_SELL_ID);
          expect(manager['trailingStopSellIds'].has(STOP_SELL_ID)).toBe(false);
        });
      });

      // Deleted at its trigger, a stop whose SELL failed (refused, an exchange error) left the position held without any stop through the
      // fall, and the strategy could not arm another one: only a BUY carries a trailing. The stop now sells until its SELL ends.
      describe('until the SELL of its stop ends', () => {
        const BUY_ID: UUID = '0b0b0b0b-0000-4000-8000-00000000000a';
        const SELL_ID: UUID = '5e115e11-0000-4000-8000-00000000000b';
        const NEXT_SELL_ID: UUID = '5e115e11-0000-4000-8000-00000000000c';
        const DORMANT_ID: UUID = 'd0e1a000-0000-4000-8000-00000000000d';
        const OWN_SELL_ID: UUID = '5e115e11-0000-4000-8000-00000000000e';
        const exchange = { price: 48000, portfolio: new Map() };
        let listener: Mock;

        /** The stop of the BUY, as the trailing manager keeps it */
        const stop = () => manager['trailingStopManager'].getOrders().get(BUY_ID);
        /** Reports the error of the SELL of the stop, with what it sold, if the event says */
        const sellErrored = (filled?: number) =>
          manager.onOrderErrored({
            order: {
              id: SELL_ID,
              symbol,
              side: 'SELL',
              type: 'MARKET',
              amount: 0.5,
              reason: 'Insufficient balance',
              orderCreationDate,
              orderErrorDate: 61000,
              ...(filled !== undefined && { filled }),
            },
            exchange,
          });
        /** Reports the cancelation of the SELL of the stop, with what it sold */
        const sellCanceled = (filled: number, remaining: number) =>
          manager.onOrderCanceled({
            order: {
              id: SELL_ID,
              symbol,
              side: 'SELL',
              type: 'MARKET',
              amount: 0.5,
              filled,
              remaining,
              orderCreationDate,
              orderCancelationDate: 61000,
            },
            exchange,
          });
        /** Reports the fill of the SELL `id` on the pair */
        const sellCompleted = (id: UUID) =>
          manager.onOrderCompleted({
            order: {
              id,
              symbol,
              side: 'SELL',
              type: 'MARKET',
              amount: 0.5,
              orderCreationDate,
              orderExecutionDate: 61000,
              effectivePrice: 48000,
              fee: 0,
            },
            exchange,
          });
        /** What the manager said at warning level of the stop of the BUY */
        const stopWarnings = () =>
          vi.mocked(warning).mock.calls.filter(([, message]) => typeof message === 'string' && message.includes(`BUY ${BUY_ID}`));

        beforeEach(() => {
          vi.mocked(randomUUID).mockReturnValueOnce(BUY_ID).mockReturnValueOnce(SELL_ID);
          manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          completeBuy(BUY_ID, 0.5);
          manager.onOneMinuteBucket(minute(50000, 48000)); // Peak 50000, stop price 49000, which its low goes through
          listener = vi.fn();
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        });

        it('keeps the stop, selling through that SELL', () => {
          expect(stop()).toEqual(expect.objectContaining({ status: 'selling', sellOrderId: SELL_ID }));
        });

        it('gives onTrailingStopTriggered the stop selling through that SELL', () => {
          expect(strategy.onTrailingStopTriggered).toHaveBeenCalledExactlyOnceWith(
            SELL_ID,
            expect.objectContaining({ id: BUY_ID, status: 'selling', sellOrderId: SELL_ID }),
            manager['tools'],
          );
        });

        it('sends no other SELL while that one is pending', () => {
          manager.onOneMinuteBucket(minute(48000, 40000));
          expect(listener).not.toHaveBeenCalled();
        });

        it('says, if the strategy ends then, that the SELL of the stop had not ended', () => {
          manager.onStrategyEnd();
          expect(warning).toHaveBeenCalledWith('strategy', 'Strategy ended with 1 triggered trailing stop(s) whose SELL had not ended.');
        });

        it('does not count it, if the strategy ends then, among the stops that never triggered', () => {
          manager.onStrategyEnd();
          expect(warning).not.toHaveBeenCalledWith('strategy', expect.stringContaining('never triggered'));
        });

        describe('once it completes', () => {
          beforeEach(() => {
            sellCompleted(SELL_ID);
          });

          it('removes the stop', () => {
            expect(stop()).toBeUndefined();
          });

          it('sends no SELL when the price falls further', () => {
            manager.onOneMinuteBucket(minute(48000, 40000));
            expect(listener).not.toHaveBeenCalled();
          });
        });

        // Refused, failed on the exchange, or expired with what the book allowed: what it did not sell is held, and the stop protects it
        // again, from the peak and the stop price it triggered at
        describe.each`
          outcome                         | end                             | amount | sale
          ${'errors, no fill reported'}   | ${() => sellErrored()}          | ${0.5} | ${'errored, no fill reported (Insufficient balance)'}
          ${'errors, 0 filled'}           | ${() => sellErrored(0)}         | ${0.5} | ${'errored, no fill reported (Insufficient balance)'}
          ${'errors after selling 0.2'}   | ${() => sellErrored(0.2)}       | ${0.3} | ${'errored after selling 0.2 BTC (Insufficient balance)'}
          ${'is canceled after 0.2 sold'} | ${() => sellCanceled(0.2, 0.3)} | ${0.3} | ${'was canceled after selling 0.2 BTC'}
          ${'is canceled, nothing sold'}  | ${() => sellCanceled(0, 0.5)}   | ${0.5} | ${'was canceled, no fill reported'}
          ${'is canceled, no fill told'}  | ${() => sellCanceled(0, 0)}     | ${0.5} | ${'was canceled, no fill reported'}
        `('once it $outcome', ({ end, amount, sale }) => {
          beforeEach(() => {
            vi.mocked(randomUUID).mockReturnValueOnce(NEXT_SELL_ID);
            end();
          });

          it('makes the stop active again', () => {
            expect(stop()?.status).toBe('active');
          });

          it('keeps the peak and the stop price it triggered at', () => {
            expect(stop()).toEqual(expect.objectContaining({ highestPeak: 50000, stopPrice: 49000 }));
          });

          it(`sends a SELL of ${amount}, what is left, on the next minute at or below its stop price`, () => {
            manager.onOneMinuteBucket(minute(48500, 48000));
            expect(listener).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({ id: NEXT_SELL_ID, symbol, side: 'SELL', type: 'MARKET', amount }),
            );
          });

          it('gives onTrailingStopTriggered that new SELL', () => {
            manager.onOneMinuteBucket(minute(48500, 48000));
            expect(strategy.onTrailingStopTriggered).toHaveBeenLastCalledWith(
              NEXT_SELL_ID,
              expect.objectContaining({ id: BUY_ID, amount }),
              manager['tools'],
            );
          });

          it('says at warning level that the stop is active again, and for what', () => {
            expect(stopWarnings()).toEqual([
              [
                'strategy',
                `Trailing stop of BUY ${BUY_ID} active again: its SELL ${SELL_ID} ${sale}. It sells ${amount} BTC once a price reaches its stop price, 49000, trailing from its peak, 50000`,
              ],
            ]);
          });
        });

        // Nothing left to sell (by hand on the exchange), or an amount out of the limits of the market: its SELL is sent again on each
        // minute at or below the stop price, and the refusals count towards the circuit breaker, which stops the run
        it('stops the run once the SELL of a stop is refused maxConsecutiveErrors times in a row', () => {
          const target = new StrategyManager(0, 3);
          target.setMarketData(defaultMarketData);
          const sells: AdviceOrder[] = [];
          target.on(STRATEGY_CREATE_ORDER_EVENT, (advice: AdviceOrder) => sells.push(advice));
          target.onOneMinuteBucket(bucket);
          target.onTimeFrameCandle(bucket); // A warmup of none is over with the first candle
          const ids: UUID[] = [
            '0b0b0b0b-0000-4000-8000-0000000000f0',
            '5e115e11-0000-4000-8000-0000000000f1',
            '5e115e11-0000-4000-8000-0000000000f2',
            '5e115e11-0000-4000-8000-0000000000f3',
          ];
          for (const id of ids) vi.mocked(randomUUID).mockReturnValueOnce(id);
          const buyId = target['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          target.onOrderCompleted({
            order: {
              id: buyId,
              symbol,
              side: 'BUY',
              type: 'MARKET',
              amount: 0.5,
              orderCreationDate,
              orderExecutionDate: 61000,
              effectivePrice: 50000,
              fee: 0,
            },
            exchange,
          });
          const refuseNextSell = () => {
            target.onOneMinuteBucket(minute(48000, 47000));
            const { id, orderCreationDate: createdAt } = sells.at(-1)!;
            target.onOrderErrored({
              order: {
                id,
                symbol,
                side: 'SELL',
                type: 'MARKET',
                amount: 0.5,
                reason: 'Insufficient balance',
                orderCreationDate: createdAt,
                orderErrorDate: 61000,
                filled: 0,
              },
              exchange,
            });
          };
          refuseNextSell();
          refuseNextSell();
          expect(refuseNextSell).toThrow(ApplicationStopError);
        });

        // Nothing is left for the stop to protect (sold by hand on the exchange, or by a SELL whose outcome was lost): active again, it
        // sent a SELL refused on each minute under its stop price, until the circuit breaker stopped the bot
        describe('once it ends without completing, by what the portfolio after it shows', () => {
          /** Ends the SELL of the stop as `outcome` says, after selling `sold`, the portfolio after it holding `balance` of BTC, if any */
          const endSell = (outcome: string, sold: number, price: number, balance?: BalanceDetail) => {
            const portfolio = new Map(balance ? [['BTC', balance]] : []);
            const order = { id: SELL_ID, symbol, side: 'SELL', type: 'MARKET', amount: 0.5, orderCreationDate } as const;
            if (outcome === 'errors')
              manager.onOrderErrored({
                order: { ...order, reason: 'Insufficient balance', orderErrorDate: 61000, filled: sold },
                exchange: { price, portfolio },
              });
            else
              manager.onOrderCanceled({
                order: { ...order, filled: sold, remaining: 0.5 - sold, orderCancelationDate: 61000 },
                exchange: { price, portfolio },
              });
          };

          // A MARKET order sells at least 0.0003 (the higher of the two minimums), in steps of 0.00001, for at least 5 USDT
          beforeEach(() => {
            manager.setMarketData(
              new Map([[symbol, { amount: { min: 0.0001 }, market: { min: 0.0003 }, cost: { min: 5 }, precision: { amount: 0.00001 } }]]),
            );
          });

          describe.each`
            shows                                                   | outcome          | sold   | price    | free        | ending
            ${'nothing free'}                                       | ${'errors'}      | ${0}   | ${48000} | ${0}        | ${'errored, no fill reported (Insufficient balance)'}
            ${'nothing free'}                                       | ${'is canceled'} | ${0}   | ${48000} | ${0}        | ${'was canceled, no fill reported'}
            ${'nothing free'}                                       | ${'errors'}      | ${0.2} | ${48000} | ${0}        | ${'errored after selling 0.2 BTC (Insufficient balance)'}
            ${'less than a MARKET order sells'}                     | ${'errors'}      | ${0}   | ${48000} | ${0.0002}   | ${'errored, no fill reported (Insufficient balance)'}
            ${'an amount worth less than 5 USDT'}                   | ${'errors'}      | ${0}   | ${10000} | ${0.0003}   | ${'errored, no fill reported (Insufficient balance)'}
            ${'an amount worth 5 USDT until truncated to its step'} | ${'errors'}      | ${0}   | ${16200} | ${0.000309} | ${'errored, no fill reported (Insufficient balance)'}
          `('when it $outcome after selling $sold, the portfolio after it showing $shows', ({ outcome, sold, price, free, ending }) => {
            beforeEach(() => {
              endSell(outcome, sold, price, { free, used: 0, total: free });
            });

            it('removes the stop', () => {
              expect(stop()).toBeUndefined();
            });

            it('says at warning level why: nothing is left for the stop to protect', () => {
              expect(stopWarnings()).toEqual([
                [
                  'strategy',
                  `Trailing stop of BUY ${BUY_ID} removed: its SELL ${SELL_ID} ${ending}, and the portfolio after it shows ${free} BTC free, too little to sell at the minimums of the market. Nothing is left for the stop to protect`,
                ],
              ]);
            });

            it('sends no SELL when the price falls further', () => {
              manager.onOneMinuteBucket(minute(48000, 40000));
              expect(listener).not.toHaveBeenCalled();
            });
          });

          // A market without minimums still takes nothing from a SELL of nothing
          it('removes the stop when the portfolio after its error shows nothing free, on a market without minimums', () => {
            manager.setMarketData(new Map([[symbol, {}]]));
            endSell('errors', 0, 48000, { free: 0, used: 0, total: 0 });
            expect(stop()).toBeUndefined();
          });

          // Reserved for an order the strategy did not create (placed by hand on the exchange), the asset is not the stop's to sell
          it('removes the stop when the portfolio after its error shows all of the asset reserved, none free', () => {
            endSell('errors', 0, 48000, { free: 0, used: 0.5, total: 0.5 });
            expect(stop()).toBeUndefined();
          });

          // Enough to sell, or nothing that tells: the stop protects what is held, as before
          it.each`
            shows                                                           | price    | balance
            ${'enough to sell'}                                             | ${48000} | ${{ free: 0.0004, used: 0, total: 0.0004 }}
            ${'enough to sell, at a price unknown (0)'}                     | ${0}     | ${{ free: 0.0003, used: 0, total: 0.0003 }}
            ${'no balance of the asset (before the first synchronization)'} | ${48000} | ${undefined}
            ${'a free balance that is not a number'}                        | ${48000} | ${{ free: NaN, used: 0, total: NaN }}
          `('makes the stop active again when the portfolio after its error shows $shows', ({ price, balance }) => {
            endSell('errors', 0, price, balance);
            expect(stop()?.status).toBe('active');
          });
        });

        // The SELL already sent is the strategy's: a stop canceled is not brought back by its outcome
        describe('when the strategy cancels the stop while it sells', () => {
          beforeEach(() => {
            vi.mocked(randomUUID).mockReturnValueOnce(DORMANT_ID);
            manager['createOrder']({ symbol, side: 'BUY', type: 'MARKET', trailing: { percentage: 2, trigger: 60000 } });
            completeBuy(DORMANT_ID, 0.3);
            manager['tools'].cancelTrailingOrder(BUY_ID);
          });

          it('removes it', () => {
            expect(stop()).toBeUndefined();
          });

          it('does not bring it back when that SELL errors', () => {
            sellErrored();
            expect(stop()).toBeUndefined();
          });

          it('cancels no other stop of the pair when that SELL completes: it sold what the stop protected', () => {
            sellCompleted(SELL_ID);
            expect(manager['trailingStopManager'].getOrders().has(DORMANT_ID)).toBe(true);
          });
        });

        // That SELL closed the position the stops of the pair protected, the one selling included
        describe('when a SELL the strategy created completes on the pair while the stop sells', () => {
          beforeEach(() => {
            vi.mocked(randomUUID).mockReturnValueOnce(OWN_SELL_ID);
            manager['createOrder']({ symbol, side: 'SELL', type: 'MARKET' });
            sellCompleted(OWN_SELL_ID);
          });

          it('cancels the stop', () => {
            expect(stop()).toBeUndefined();
          });

          it('does not bring it back when the SELL of the stop errors', () => {
            sellErrored();
            expect(stop()).toBeUndefined();
          });
        });
      });

      // A STICKY BUY whose relaunch failed, or an order whose poll or cancelation failed for good, errors after its fills: dropped, the
      // stop the strategy asked for left the coins bought without protection
      describe('when a BUY asking for a stop errors', () => {
        const BUY_ID: UUID = '0b0b0b0b-0000-4000-8000-0000000000a1';
        const OTHER_ID: UUID = '0b0b0b0b-0000-4000-8000-0000000000a2';
        const OUTCOME_UNKNOWN =
          'Outcome unknown: the order may be live on the exchange, check it before placing it again (Request timeout)';
        const exchange = { price: 50000, portfolio: new Map() };
        /** Reports the error of the BUY `id` of 1, with what it filled, if the event says */
        const fail = (id: UUID, reason: string, filled?: number) =>
          manager.onOrderErrored({
            order: {
              id,
              symbol,
              side: 'BUY',
              type: 'STICKY',
              amount: 1,
              reason,
              orderCreationDate,
              orderErrorDate: 61000,
              ...(filled !== undefined && { filled }),
            },
            exchange,
          });

        beforeEach(() => {
          vi.mocked(randomUUID).mockReturnValueOnce(BUY_ID);
          manager['createOrder']({ symbol, side: 'BUY', type: 'STICKY', amount: 1, trailing: { percentage: 2 } });
        });

        describe('after it filled part of its amount', () => {
          beforeEach(() => {
            fail(BUY_ID, 'Ticker unavailable (0.6 of 1 already filled)', 0.6);
          });

          it('arms its stop for what it filled', () => {
            expect(manager['trailingStopManager'].getOrders().get(BUY_ID)?.amount).toBe(0.6);
          });

          it('keeps it pending no more', () => {
            expect(manager['pendingTrailingStops'].has(BUY_ID)).toBe(false);
          });

          it('announces the activation of its stop, which has no trigger', () => {
            expect(strategy.onTrailingStopActivated).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({ id: BUY_ID, amount: 0.6, status: 'active' }),
              manager['tools'],
            );
          });

          it('sells what it filled when the price falls through its stop price', () => {
            const listener = vi.fn();
            manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
            manager.onOneMinuteBucket(minute(50000, 48000));
            expect(listener).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({ symbol, side: 'SELL', type: 'MARKET', amount: 0.6 }),
            );
          });

          it('says so at warning level', () => {
            expect(warning).toHaveBeenCalledExactlyOnceWith(
              'strategy',
              `BUY ${BUY_ID} errored after it filled 0.6 of 1 BTC (Ticker unavailable (0.6 of 1 already filled)): its trailing stop is armed for that part`,
            );
          });
        });

        // Its outcome unknown, its creation lost on the network, it may have executed all the same: nothing tells what to arm (nor does a
        // fill that is not a number above 0), and kept pending the stop would never be armed, no completion following an error
        describe.each`
          report        | filled
          ${'0 filled'} | ${0}
          ${'no fill'}  | ${undefined}
          ${'NaN'}      | ${NaN}
          ${'Infinity'} | ${Infinity}
        `('reporting $report', ({ filled }) => {
          beforeEach(() => {
            fail(BUY_ID, OUTCOME_UNKNOWN, filled);
          });

          it('arms no stop', () => {
            expect(manager['trailingStopManager'].getOrders().size).toBe(0);
          });

          it('drops its pending stop', () => {
            expect(manager['pendingTrailingStops'].has(BUY_ID)).toBe(false);
          });

          it('says at warning level that its stop is not armed, and what it means if the BUY executed all the same', () => {
            expect(warning).toHaveBeenCalledExactlyOnceWith(
              'strategy',
              `Trailing stop of BUY ${BUY_ID} not armed: the BUY errored, no fill reported (${OUTCOME_UNKNOWN}). If it executed all the same, as an order whose outcome is unknown may have, what it bought has no stop`,
            );
          });
        });

        it('says nothing of a stop when an errored order asked for none', () => {
          fail(OTHER_ID, 'Ticker unavailable (0.6 of 1 already filled)', 0.6);
          expect(warning).not.toHaveBeenCalled();
        });

        // Kept as it was: a BUY canceled drops the stop it asked for, even after a partial fill
        it('drops its stop when it is canceled after a partial fill', () => {
          manager.onOrderCanceled({
            order: {
              id: BUY_ID,
              symbol,
              side: 'BUY',
              type: 'STICKY',
              amount: 1,
              filled: 0.6,
              remaining: 0.4,
              orderCreationDate,
              orderCancelationDate: 61000,
            },
            exchange,
          });
          expect([manager['pendingTrailingStops'].size, manager['trailingStopManager'].getOrders().size]).toEqual([0, 0]);
        });
      });

      // The exchange reserves the asset for a SELL the strategy created: a stop that triggered while that SELL was pending had its own
      // SELL refused, then, active again, sent it on each minute under its stop price, each refusal counting towards the circuit breaker,
      // which stopped the bot
      describe('while a SELL the strategy created is pending on the pair', () => {
        const BUY_ID: UUID = '0b0b0b0b-0000-4000-8000-0000000000c1';
        const OWN_SELL_ID: UUID = '5e115e11-0000-4000-8000-0000000000c2';
        const OTHER_SELL_ID: UUID = '5e115e11-0000-4000-8000-0000000000c3';
        const STOP_SELL_ID: UUID = '5e115e11-0000-4000-8000-0000000000c4';
        const LATER_BUY_ID: UUID = '0b0b0b0b-0000-4000-8000-0000000000c5';
        const ETH_ID: UUID = 'e7e70000-0000-4000-8000-0000000000c6';
        const exchange = { price: 48000, portfolio: new Map() };
        let listener: Mock;

        /** Creates an order as the strategy does, createOrder drawing `id` for it */
        const create = (id: UUID, order: StrategyOrder) => {
          vi.mocked(randomUUID).mockReturnValueOnce(id);
          manager['createOrder'](order);
        };
        /** A BUY of `amount` asking for a stop of `percentage` without trigger, completed: its stop is armed */
        const armStop = (id: UUID, amount: number, percentage: number) => {
          create(id, { symbol, side: 'BUY', type: 'MARKET', trailing: { percentage } });
          completeBuy(id, amount);
        };
        /** The take-profit `id` the strategy places: a LIMIT SELL of 0.5 above the market, whose amount the exchange reserves */
        const placeTakeProfit = (id: UUID) => create(id, { symbol, side: 'SELL', type: 'LIMIT', amount: 0.5, price: 55000 });
        /** The take-profit `id`, as the Trader relays its end */
        const takeProfit = (id: UUID) =>
          ({ id, symbol, side: 'SELL', type: 'LIMIT', amount: 0.5, price: 55000, orderCreationDate }) as const;
        const cancelTakeProfit = (id: UUID) =>
          manager.onOrderCanceled({ order: { ...takeProfit(id), filled: 0, remaining: 0.5, orderCancelationDate: 61000 }, exchange });
        const failTakeProfit = (id: UUID) =>
          manager.onOrderErrored({
            order: { ...takeProfit(id), reason: 'Exchange unavailable', orderErrorDate: 61000, filled: 0 },
            exchange,
          });
        const completeTakeProfit = (id: UUID) =>
          manager.onOrderCompleted({ order: { ...takeProfit(id), orderExecutionDate: 61000, effectivePrice: 55000, fee: 0 }, exchange });
        /** The stop of the BUY, as the trailing manager keeps it */
        const stop = () => manager['trailingStopManager'].getOrders().get(BUY_ID);
        /** What the manager said at info level of the stop of the BUY */
        const stopLines = () =>
          vi.mocked(info).mock.calls.filter(([, message]) => typeof message === 'string' && message.includes(`BUY ${BUY_ID}`));
        const heldLine = (sellIds: string) => [
          'strategy',
          `Trailing stop of BUY ${BUY_ID} held back: a price, 48500, reached its stop price, 49000, while a SELL the strategy created on BTC/USDT is pending (${sellIds}). The stop sends no SELL until that one ends: completed, it cancels the stop; canceled or errored, the stop may trigger again from the next minute`,
        ];
        const resumeLine = (sellId: UUID, outcome: string) => [
          'strategy',
          `Trailing stop of BUY ${BUY_ID} resumes: the SELL ${sellId} the strategy created on BTC/USDT ${outcome}, and no other is pending there, so the stop may trigger again from the next minute`,
        ];
        /** Records every order created from now on */
        const listen = () => {
          listener = vi.fn();
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        };

        // A stop of 2% without trigger, which a first minute sets at a peak of 50000 and a stop price of 49000, then a take-profit
        describe('placed once the stop is armed', () => {
          beforeEach(() => {
            armStop(BUY_ID, 0.5, 2);
            manager.onOneMinuteBucket(minute(50000, 49500));
            placeTakeProfit(OWN_SELL_ID);
            listen();
          });

          describe('when a price goes through the stop price', () => {
            beforeEach(() => {
              manager.onOneMinuteBucket(minute(48500, 48000));
            });

            it('sends no SELL', () => {
              expect(listener).not.toHaveBeenCalled();
            });

            it('does not tell the strategy the stop triggered', () => {
              expect(strategy.onTrailingStopTriggered).not.toHaveBeenCalled();
            });

            it('keeps the stop active', () => {
              expect(stop()?.status).toBe('active');
            });

            it('says at info level that the stop is held back, by which SELL, and until when', () => {
              expect(stopLines()).toEqual([heldLine(OWN_SELL_ID)]);
            });

            it('says it once, however long the price stays under the stop price', () => {
              manager.onOneMinuteBucket(minute(47000, 46000));
              expect(stopLines()).toEqual([heldLine(OWN_SELL_ID)]);
            });

            // Its open raises the peak to 55000, the stop price to 53900, which its low stays above
            it('keeps trailing the peak: a new high raises the stop price', () => {
              manager.onOneMinuteBucket(minute(55000, 54500));
              expect(stop()?.stopPrice).toBe(53900);
            });
          });

          // Canceled (moved, or given up) or errored, the take-profit left the position held: the stop protects it again
          describe.each`
            outcome          | end                 | said
            ${'is canceled'} | ${cancelTakeProfit} | ${'was canceled'}
            ${'errors'}      | ${failTakeProfit}   | ${'errored'}
          `('once that SELL $outcome, after it held back the stop', ({ end, said }) => {
            beforeEach(() => {
              manager.onOneMinuteBucket(minute(48500, 48000));
              end(OWN_SELL_ID);
            });

            it('says at info level that the stop resumes, and why', () => {
              expect(stopLines()).toEqual([heldLine(OWN_SELL_ID), resumeLine(OWN_SELL_ID, said)]);
            });

            it('sends the SELL of the stop on the next minute at or below its stop price', () => {
              vi.mocked(randomUUID).mockReturnValueOnce(STOP_SELL_ID);
              manager.onOneMinuteBucket(minute(48500, 48000));
              expect(listener).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ id: STOP_SELL_ID, symbol, side: 'SELL', type: 'MARKET', amount: 0.5 }),
              );
            });

            it('says it held the stop back again when a later SELL of the strategy does', () => {
              placeTakeProfit(OTHER_SELL_ID);
              manager.onOneMinuteBucket(minute(48500, 48000));
              expect(stopLines().at(-1)).toEqual(heldLine(OTHER_SELL_ID));
            });

            it('forgets that SELL', () => {
              expect(manager['strategySellIds'].has(OWN_SELL_ID)).toBe(false);
            });
          });

          // It closed the position the stop protected (see 'when the strategy sells on a pair')
          describe('once that SELL completes, after it held back the stop', () => {
            beforeEach(() => {
              manager.onOneMinuteBucket(minute(48500, 48000));
              completeTakeProfit(OWN_SELL_ID);
            });

            it('cancels the stop, without a word of it resuming', () => {
              expect(stopLines()).toEqual([
                heldLine(OWN_SELL_ID),
                [
                  'strategy',
                  `Trailing stop of BUY ${BUY_ID} canceled: the strategy sold on BTC/USDT (SELL ${OWN_SELL_ID} completed), closing the position the stop protected`,
                ],
              ]);
            });

            it('sends no SELL when the price falls further', () => {
              manager.onOneMinuteBucket(minute(47000, 46000));
              expect(listener).not.toHaveBeenCalled();
            });

            it('forgets the stop it held back', () => {
              expect(manager['heldStopIds'].has(BUY_ID)).toBe(false);
            });

            // Its outcome came: it holds nothing back any more
            it('lets the stop of a later BUY on the pair trigger', () => {
              armStop(LATER_BUY_ID, 0.4, 2);
              manager.onOneMinuteBucket(minute(50000, 48000));
              expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ symbol, side: 'SELL', type: 'MARKET', amount: 0.4 }));
            });
          });

          // Two take-profits: the stop is held back until neither is pending
          describe('when another SELL the strategy created is pending there', () => {
            beforeEach(() => {
              placeTakeProfit(OTHER_SELL_ID);
              listen();
            });

            it('names both as it holds the stop back', () => {
              manager.onOneMinuteBucket(minute(48500, 48000));
              expect(stopLines()).toEqual([heldLine(`${OWN_SELL_ID}, ${OTHER_SELL_ID}`)]);
            });

            describe('once one of them errors', () => {
              beforeEach(() => {
                failTakeProfit(OWN_SELL_ID);
                manager.onOneMinuteBucket(minute(48500, 48000));
              });

              it('still holds the stop back', () => {
                expect(listener).not.toHaveBeenCalled();
              });

              it('says nothing of the stop resuming, and names the other as it holds the stop back', () => {
                expect(stopLines()).toEqual([heldLine(OTHER_SELL_ID)]);
              });
            });
          });
        });

        // The stop triggered first; the strategy then created a SELL of its own, which reached the exchange first: the SELL of the stop
        // was refused, all of the asset reserved for the strategy's
        describe('when the SELL of the stop is refused, the asset reserved for a SELL the strategy created since', () => {
          beforeEach(() => {
            armStop(BUY_ID, 0.5, 2);
            vi.mocked(randomUUID).mockReturnValueOnce(STOP_SELL_ID);
            manager.onOneMinuteBucket(minute(50000, 48000)); // Peak 50000, stop price 49000, which its low goes through
            create(OWN_SELL_ID, { symbol, side: 'SELL', type: 'STICKY' });
            manager.onOrderErrored({
              order: {
                id: STOP_SELL_ID,
                symbol,
                side: 'SELL',
                type: 'MARKET',
                amount: 0.5,
                reason: 'Insufficient balance',
                orderCreationDate,
                orderErrorDate: 61000,
                filled: 0,
              },
              exchange: { price: 48000, portfolio: new Map([['BTC', { free: 0, used: 0.5, total: 0.5 }]]) },
            });
            listen();
          });

          it('makes the stop active again, though nothing is free: that SELL holds the asset', () => {
            expect(stop()?.status).toBe('active');
          });

          it('does not send the SELL of the stop again while that SELL is pending', () => {
            manager.onOneMinuteBucket(minute(48500, 48000));
            expect(listener).not.toHaveBeenCalled();
          });

          it('sends it once that SELL is canceled', () => {
            manager.onOrderCanceled({
              order: {
                id: OWN_SELL_ID,
                symbol,
                side: 'SELL',
                type: 'STICKY',
                amount: 0.5,
                filled: 0,
                remaining: 0.5,
                orderCreationDate,
                orderCancelationDate: 61000,
              },
              exchange,
            });
            manager.onOneMinuteBucket(minute(48500, 48000));
            expect(listener).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({ symbol, side: 'SELL', type: 'MARKET', amount: 0.5 }),
            );
          });
        });

        // Its SELL went out before the strategy's, which holds back no trigger already sent
        it('says nothing of resuming a stop that sells as that SELL ends', () => {
          armStop(BUY_ID, 0.5, 2);
          manager.onOneMinuteBucket(minute(50000, 48000));
          placeTakeProfit(OWN_SELL_ID);
          cancelTakeProfit(OWN_SELL_ID);
          expect(stopLines()).toEqual([]);
        });

        // Each stop sells what its own BUY filled: the SELL of one is not a SELL of the strategy's
        it('lets each stop the price goes through send its SELL, the SELL of one holding back no other', () => {
          armStop(BUY_ID, 0.5, 2);
          armStop(LATER_BUY_ID, 0.3, 5);
          listen();
          vi.mocked(randomUUID).mockReturnValueOnce(STOP_SELL_ID).mockReturnValueOnce(OTHER_SELL_ID);
          manager.onOneMinuteBucket(minute(50000, 46000)); // Stop prices 49000 and 47500, both above its low
          expect(listener.mock.calls.map(([advice]) => advice.amount)).toEqual([0.5, 0.3]);
        });

        it('holds back no stop of another pair', () => {
          manager.setMarketData(twoPairsMarketData);
          create(ETH_ID, { symbol: 'ETH/USDT', side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          manager.onOrderCompleted({
            order: {
              id: ETH_ID,
              symbol: 'ETH/USDT',
              side: 'BUY',
              type: 'MARKET',
              amount: 2,
              orderCreationDate,
              orderExecutionDate: 61000,
              effectivePrice: 3000,
              fee: 0,
            },
            exchange,
          });
          placeTakeProfit(OWN_SELL_ID);
          listen();
          // Peak 3000, stop price 2940, which its low goes through
          manager.onOneMinuteBucket(new Map([['ETH/USDT', { start: 120000, open: 3000, high: 3000, low: 2900, close: 2900, volume: 1 }]]));
          expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ symbol: 'ETH/USDT', side: 'SELL', amount: 2 }));
        });
      });
    });
  });

  describe('setters function', () => {
    describe('onPortfolioChange', () => {
      it('gives the candle hooks the portfolio received', () => {
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

        manager.onPortfolioChange(portfolio);

        manager.onTimeFrameCandle(bucket);

        const params = strategy.onEachTimeframeCandle.mock.calls[0]?.[0];
        expect(params?.portfolio).toEqual(portfolio);
      });
    });
    describe('setMarketData', () => {
      it('applies the provided market data to newly created tools', () => {
        const marketData = new Map([['BTC/USDT', { amount: { min: 0.1, max: 5 } }]]) as any;

        manager.setMarketData(marketData);

        const tools = manager['tools'];
        expect(tools.marketData).toEqual(marketData);
      });
    });
  });

  // What a hook received was the engine's own object: what the strategy wrote there changed the configuration, the exchange, an
  // indicator, what the other plugins received, or what the manager itself went by. Each test has the strategy write into what it
  // receives, then reads the original.
  describe('what the strategy receives, its own copy', () => {
    describe('tools.strategyParams', () => {
      let block: { name: string; each: number; thresholds: { up: number } };

      beforeEach(async () => {
        block = { name: 'DummyStrategy', each: 1, thresholds: { up: 1 } };
        vi.mocked(config.getStrategy).mockReturnValue(block);
        manager = new StrategyManager(1);
        manager.setMarketData(defaultMarketData);
        await manager.createStrategy('DummyStrategy');
        const strategy: any = manager['strategy'];
        strategy.init.mockImplementation(({ tools }: InitParams<typeof block>) => {
          tools.strategyParams.each = 2;
          tools.strategyParams.thresholds.up = 9;
        });
        manager.onOneMinuteBucket(bucket); // Runs init
      });

      // A strategy without schema got the block itself, which every plugin keeps: the PerformanceReporter makes its run id of it
      it('leaves the block of the configuration as it was', () => {
        expect(block).toEqual({ name: 'DummyStrategy', each: 1, thresholds: { up: 1 } });
      });

      it('keeps what the strategy wrote in its own copy', () => {
        expect(manager['tools'].strategyParams).toEqual({ name: 'DummyStrategy', each: 2, thresholds: { up: 9 } });
      });
    });

    describe('tools.marketData', () => {
      let entry: MarketData;

      beforeEach(() => {
        entry = { amount: { min: 0.0001 }, fee: { maker: 0.001, taker: 0.001 } };
        manager.setMarketData(new Map([['BTC/USDT', entry]]));
        manager['strategy'] = {
          init: ({ tools }: InitParams<object>) => {
            tools.marketData.get('BTC/USDT')!.fee!.taker = 0;
            tools.marketData.set('ETH/USDT', { amount: { min: 0.001 } });
          },
        };
        manager.onOneMinuteBucket(bucket); // Runs init
      });

      // On dummy-cex and paper trading the entry is the one the simulator charges and checks orders with
      it('leaves the entry of the exchange as it was', () => {
        expect(entry).toEqual({ amount: { min: 0.0001 }, fee: { maker: 0.001, taker: 0.001 } });
      });

      it('keeps the pairs it checks orders and indicators against', () => {
        expect([...manager['marketData'].keys()]).toEqual(['BTC/USDT']);
      });

      it('refuses an order on a pair the strategy added to its copy', () => {
        completeWarmup();
        expect(() => manager['createOrder']({ symbol: 'ETH/USDT', side: 'BUY', type: 'MARKET' })).toThrow(
          `symbol must be one of the watched pairs (BTC/USDT), got ${quoted('ETH/USDT')}`,
        );
      });
    });

    describe('the portfolio of the candle hooks', () => {
      const balances = (): Portfolio =>
        new Map([
          ['USDT', { free: 1000, used: 0, total: 1000 }],
          ['BTC', { free: 1, used: 0, total: 1 }],
        ]);
      let portfolio: Portfolio;

      beforeEach(() => {
        portfolio = balances();
        manager.onPortfolioChange(portfolio);
        manager['strategy'] = {
          onEachTimeframeCandle: ({ portfolio: own }: OnCandleEventParams<object>) => {
            own.get('USDT')!.free = 0;
            own.delete('BTC');
          },
        };
        manager.onTimeFrameCandle(bucket);
      });

      // One clone is shared by every plugin listening to the change of portfolio, the analyzers keeping it as their latest
      it('leaves the portfolio the other plugins received as it was', () => {
        expect(portfolio).toEqual(balances());
      });

      it('keeps what the strategy wrote in its own copy until the next change', () => {
        expect(manager['portfolio']).toEqual(new Map([['USDT', { free: 0, used: 0, total: 1000 }]]));
      });
    });

    describe('the event of an order hook', () => {
      const ORDER_ID: UUID = '0e0e0e0e-0000-4000-8000-000000000001';
      const order = { id: ORDER_ID, symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', amount: 0.5, orderCreationDate: 60000 } as const;
      const exchangeEvent = (): ExchangeEvent => ({ price: 100, portfolio: new Map([['BTC', { free: 0.5, used: 0, total: 0.5 }]]) });
      // A BUY of 0.5 that completes, is canceled after filling 0.2, or errors after filling 0.2
      const EVENTS = {
        onOrderCompleted: (): OrderCompletedEvent => ({
          order: { ...order, orderExecutionDate: 60000, effectivePrice: 100, fee: 0.05 },
          exchange: exchangeEvent(),
        }),
        onOrderCanceled: (): OrderCanceledEvent => ({
          order: { ...order, orderCancelationDate: 60000, filled: 0.2, remaining: 0.3 },
          exchange: exchangeEvent(),
        }),
        onOrderErrored: (): OrderErroredEvent => ({
          order: { ...order, orderErrorDate: 60000, reason: 'Insufficient balance', filled: 0.2 },
          exchange: exchangeEvent(),
        }),
      };
      type Handler = keyof typeof EVENTS;
      type OrderHookParams = { order: { side: OrderSide; amount: number; filled?: number }; exchange: ExchangeEvent };
      /** What a strategy could write in any of its order hooks */
      const rewrite = ({ order: own, exchange }: OrderHookParams) => {
        own.side = 'SELL';
        own.amount = 99;
        own.filled = 0.4;
        exchange.portfolio.clear();
        exchange.price = 0;
      };

      describe.each`
        handler
        ${'onOrderCompleted'}
        ${'onOrderCanceled'}
        ${'onOrderErrored'}
      `('$handler', ({ handler }: { handler: Handler }) => {
        let event: ReturnType<(typeof EVENTS)[Handler]>;

        beforeEach(() => {
          manager['strategy'] = { [handler]: rewrite };
          event = EVENTS[handler]();
          manager[handler](event as any);
        });

        // One clone is shared by every plugin listening to the event, the analyzers reading it after the strategy
        it('leaves the order the other plugins receive as it was', () => {
          expect(event.order).toEqual(EVENTS[handler]().order);
        });

        it('leaves the portfolio and the price of the event as they were', () => {
          expect(event.exchange).toEqual(exchangeEvent());
        });
      });

      // The manager reads the event again once the hook has run: a BUY rewritten to a SELL canceled the stop it had just armed, and a
      // fill rewritten armed the stop for that amount
      it.each`
        outcome                  | handler               | armed
        ${'completes'}           | ${'onOrderCompleted'} | ${0.5}
        ${'errors after a fill'} | ${'onOrderErrored'}   | ${0.2}
      `(
        'arms the stop of a BUY that $outcome for what it filled, whatever the strategy wrote to its order',
        ({ handler, armed }: { handler: Handler; armed: number }) => {
          vi.mocked(randomUUID).mockReturnValueOnce(ORDER_ID);
          completeWarmup();
          manager['createOrder']({ symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } });
          manager['strategy'] = { [handler]: rewrite };
          manager[handler](EVENTS[handler]() as any);
          expect(manager['trailingStopManager'].getOrders().get(ORDER_ID)?.amount).toBe(armed);
        },
      );
    });

    describe('the results of an indicator', () => {
      let macd: { macd: number; signal: number; hist: number };
      let ribbon: { results: number[]; spread: number };

      beforeEach(() => {
        macd = { macd: 1, signal: 2, hist: -1 };
        ribbon = { results: [3, 2, 1], spread: 2 };
        manager['indicators'].push(
          { indicator: { onNewCandle: vi.fn(), getResult: vi.fn(() => macd) }, symbol: 'BTC/USDT' } as any,
          { indicator: { onNewCandle: vi.fn(), getResult: vi.fn(() => ribbon) }, symbol: 'BTC/USDT' } as any,
        );
        manager['strategy'] = {
          onEachTimeframeCandle: (_params: OnCandleEventParams<object>, ...indicators: IndicatorResults[]) => {
            const [ownMacd, ownRibbon] = indicators as [IndicatorResults<typeof macd>, IndicatorResults<typeof ribbon>];
            ownMacd.results.hist = 42;
            ownRibbon.results.results.sort((a, b) => a - b);
          },
        };
        manager.onTimeFrameCandle(bucket);
      });

      it('leaves the result object of the indicator as it was', () => {
        expect(macd).toEqual({ macd: 1, signal: 2, hist: -1 });
      });

      it('leaves the array of a ribbon in its order', () => {
        expect(ribbon.results).toEqual([3, 2, 1]);
      });
    });

    describe('the candles of a timeframe bucket', () => {
      const CANDLE = { start: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1 };
      let timeframeBucket: CandleBucket;
      let indicator: { onNewCandle: Mock; getResult: Mock };
      let warmupListener: Mock;

      beforeEach(() => {
        // Without warmup the first candle completes it: its warmup event follows onEachTimeframeCandle
        manager = new StrategyManager(0);
        manager.setMarketData(defaultMarketData);
        indicator = { onNewCandle: vi.fn(), getResult: vi.fn(() => null) };
        manager['indicators'].push({ indicator, symbol: 'BTC/USDT' } as any);
        warmupListener = vi.fn();
        manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, warmupListener);
        manager['strategy'] = {
          // Once the indicators are fed
          onEachTimeframeCandle: ({ candle }: OnCandleEventParams<object>) => {
            candle.get('BTC/USDT')!.high = 99;
            candle.delete('BTC/USDT');
          },
        };
        timeframeBucket = new Map([['BTC/USDT', { ...CANDLE }]]);
        manager.onTimeFrameCandle(timeframeBucket);
      });

      // The TradingAdvisor queues it as the timeframe candle event once the hooks have run
      it('leaves the bucket as it was', () => {
        expect(timeframeBucket).toEqual(new Map([['BTC/USDT', CANDLE]]));
      });

      // TrueRange, PSAR and ±DM keep the candle they are fed, and read it again on the next one
      it('feeds the indicators the candle as it was', () => {
        expect(indicator.onNewCandle).toHaveBeenCalledExactlyOnceWith(CANDLE);
      });

      it('emits the warmup event with the bucket as it was', () => {
        expect(warmupListener).toHaveBeenCalledExactlyOnceWith(new Map([['BTC/USDT', CANDLE]]));
      });
    });

    describe('the candles of the one-minute bucket init runs on', () => {
      // Every plugin receives that bucket, and the TradingAdvisor batches it into its first timeframe candle
      it('leaves the bucket as it was', () => {
        manager['strategy'] = {
          init: ({ candle: own }: InitParams<object>) => {
            own.get('BTC/USDT')!.close = 0;
            own.delete('BTC/USDT');
          },
        };
        const minuteBucket: CandleBucket = new Map([['BTC/USDT', { ...candle }]]);
        manager.onOneMinuteBucket(minuteBucket);
        expect(minuteBucket).toEqual(new Map([['BTC/USDT', candle]]));
      });
    });
  });

  describe('functions used in trader strategies', () => {
    describe('addIndicator', () => {
      /** Registers an SMA on `symbol`, and returns what it throws */
      const addSmaOn = (symbol: TradingPair) => {
        try {
          manager['addIndicator']('SMA', symbol, { period: 10 });
        } catch (caught) {
          return caught;
        }
      };

      it('creates the indicator of the registry with its parameters', () => {
        manager['addIndicator']('SMA', 'BTC/USDT', { period: 10 });
        expect(indicatorMocks.IndicatorMock).toHaveBeenCalledWith({ period: 10 });
      });

      it('keeps the indicator with its pair', () => {
        manager['addIndicator']('SMA', 'BTC/USDT', { period: 10 });
        expect(manager['indicators']).toEqual([{ indicator: indicatorMocks.IndicatorMock.mock.instances[0], symbol: 'BTC/USDT' }]);
      });

      it('returns nothing, as AddIndicatorFn says: the indicator stays with the manager', () => {
        expect(manager['addIndicator']('SMA', 'BTC/USDT', { period: 10 })).toBeUndefined();
      });

      it('throws when indicator is unknown', () => {
        expect(() => manager['addIndicator']('UNKNOWN' as any, 'BTC/USDT', {})).toThrow(GekkoError);
      });

      it('keeps an indicator on any watched pair, not only the first', () => {
        manager.setMarketData(twoPairsMarketData);
        manager['addIndicator']('SMA', 'ETH/USDT', { period: 10 });
        expect(manager['indicators']).toEqual([{ indicator: indicatorMocks.IndicatorMock.mock.instances[0], symbol: 'ETH/USDT' }]);
      });

      // An indicator on a pair that is not watched never got a candle: its results stayed null for the whole run, so a strategy waiting
      // for them never traded, with one warning per candle that the default log level hid
      describe.each`
        problem                                    | symbol        | shown
        ${'an unwatched pair'}                     | ${'ETH/USDT'} | ${quoted('ETH/USDT')}
        ${'the watched asset in another currency'} | ${'BTC/USDC'} | ${quoted('BTC/USDC')}
        ${'a watched pair in lower case'}          | ${'btc/usdt'} | ${quoted('btc/usdt')}
        ${'the exchange id of a watched pair'}     | ${'BTCUSDT'}  | ${quoted('BTCUSDT')}
        ${'no pair (an untyped strategy)'}         | ${undefined}  | ${'undefined'}
      `('on $problem', ({ symbol, shown }) => {
        let failure: unknown;

        beforeEach(() => {
          failure = addSmaOn(symbol);
        });

        it('refuses the indicator with a GekkoError', () => {
          expect(failure).toBeInstanceOf(GekkoError);
        });

        it('names the indicator and its pair, and lists the watched pairs', () => {
          expect(failure).toHaveProperty(
            'message',
            `[STRATEGY] Impossible to add the SMA indicator on ${symbol}: symbol must be one of the watched pairs (BTC/USDT), got ${shown}`,
          );
        });

        it('creates no indicator', () => {
          expect(indicatorMocks.IndicatorMock).not.toHaveBeenCalled();
        });

        it('keeps no indicator', () => {
          expect(manager['indicators']).toEqual([]);
        });
      });

      it('lists every watched pair when it refuses one that is not', () => {
        manager.setMarketData(twoPairsMarketData);
        expect(addSmaOn('ETH/BTC')).toHaveProperty(
          'message',
          `[STRATEGY] Impossible to add the SMA indicator on ETH/BTC: symbol must be one of the watched pairs (BTC/USDT, ETH/USDT), got ${quoted('ETH/BTC')}`,
        );
      });

      // Kept from init and called from a later hook, it added an indicator fed from then on only, and one more argument to every hook:
      // one per candle for a strategy that called it on each. When it is called is what is wrong, whatever the name.
      describe.each`
        kind                      | name
        ${'an indicator'}         | ${'SMA'}
        ${'an unknown indicator'} | ${'UNKNOWN'}
      `('when the strategy adds $kind from a later hook, with addIndicator kept from init', ({ name }) => {
        let failure: unknown;

        beforeEach(() => {
          let kept: AddIndicatorFn | undefined;
          manager['strategy'] = {
            init: ({ addIndicator }: InitParams<object>) => {
              kept = addIndicator;
            },
            onEachTimeframeCandle: () => kept?.(name, 'BTC/USDT', { period: 10 }),
          };
          manager.onOneMinuteBucket(bucket);
          failure = undefined;
          try {
            manager.onTimeFrameCandle(bucket);
          } catch (caught) {
            failure = caught;
          }
        });

        it('refuses the indicator with a GekkoError', () => {
          expect(failure).toBeInstanceOf(GekkoError);
        });

        it('names the indicator and its pair, and says that addIndicator is available in init only', () => {
          expect(failure).toHaveProperty(
            'message',
            `[STRATEGY] Impossible to add the ${name} indicator on BTC/USDT: addIndicator is available in init only`,
          );
        });

        it('creates no indicator', () => {
          expect(indicatorMocks.IndicatorMock).not.toHaveBeenCalled();
        });

        it('keeps no indicator', () => {
          expect(manager['indicators']).toEqual([]);
        });
      });
    });

    describe('createOrder', () => {
      // Orders are available once the warmup is over: the manager's is one candle, which the second candle completes
      beforeEach(() => completeWarmup());

      it('createOrder emits the advice event', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        const order = { side: 'BUY', type: 'STICKY', quantity: 1, symbol: 'BTC/USDT' } as const;

        const id = manager['createOrder'](order);

        expect(id).toBe('db2254e3-c749-448c-b7b6-aa28831bbae7');
        // Dated with the clock as it is: already the end of the minute being processed (its bucket starts at candle.start), which is
        // when the Trader and the simulated exchange date fills and errors. A minute added to it dated the order after its own fill.
        expect(listener).toHaveBeenCalledWith({
          ...order,
          id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
          orderCreationDate: candle.start + ONE_MINUTE,
        });
      });

      it('throws if no timestamp available', () => {
        manager['currentTimestamp'] = 0;
        const order = { side: 'BUY', type: 'STICKY', quantity: 1, symbol: 'BTC/USDT' } as const;
        expect(() => manager['createOrder'](order)).toThrow('No candle when relaying advice');
      });

      // An order on a pair that is not watched reached the Trader: given a price, a live exchange placed it (an all-in BUY spending the
      // currency of the watched pairs), though Gekko has no candle or balance of that pair, while the simulator refused it
      describe('on the pair it names', () => {
        let listener: Mock;

        /** Creates `order` as the strategy does, and returns what it throws */
        const createOn = (order: StrategyOrder) => {
          try {
            manager['createOrder'](order);
          } catch (caught) {
            return caught;
          }
        };

        beforeEach(() => {
          listener = vi.fn();
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        });

        // The last two ask for a stop: the pair is checked first, before anything is kept
        describe.each`
          problem                                                | order                                                                                | shown
          ${'a priced LIMIT BUY on an unwatched pair'}           | ${{ symbol: 'ETH/USDT', side: 'BUY', type: 'LIMIT', price: 3000 }}                   | ${quoted('ETH/USDT')}
          ${'a SELL of the watched asset in another currency'}   | ${{ symbol: 'BTC/USDC', side: 'SELL', type: 'MARKET', amount: 1 }}                   | ${quoted('BTC/USDC')}
          ${'a STICKY BUY on the exchange id of a watched pair'} | ${{ symbol: 'BTCUSDT', side: 'BUY', type: 'STICKY' }}                                | ${quoted('BTCUSDT')}
          ${'a BUY without a pair (an untyped strategy)'}        | ${{ side: 'BUY', type: 'MARKET' }}                                                   | ${'undefined'}
          ${'a BUY with a stop on a watched pair in lower case'} | ${{ symbol: 'btc/usdt', side: 'BUY', type: 'MARKET', trailing: { percentage: 2 } }}  | ${quoted('btc/usdt')}
          ${'a SELL with a stop on an unwatched pair'}           | ${{ symbol: 'ETH/USDT', side: 'SELL', type: 'MARKET', trailing: { percentage: 2 } }} | ${quoted('ETH/USDT')}
        `('when the strategy creates $problem', ({ order, shown }) => {
          let failure: unknown;

          beforeEach(() => {
            failure = createOn(order);
          });

          it('refuses the order with a GekkoError', () => {
            expect(failure).toBeInstanceOf(GekkoError);
          });

          it('names the order and its pair, and lists the watched pairs', () => {
            expect(failure).toHaveProperty(
              'message',
              `[STRATEGY] Impossible to create the ${order.side} ${order.type} order on ${order.symbol}: symbol must be one of the watched pairs (BTC/USDT), got ${shown}`,
            );
          });

          it('relays no order', () => {
            expect(listener).not.toHaveBeenCalled();
          });

          it('keeps no trailing stop', () => {
            expect(manager['pendingTrailingStops'].size).toBe(0);
          });
        });

        it('lists every watched pair when it refuses one that is not', () => {
          manager.setMarketData(twoPairsMarketData);
          expect(createOn({ symbol: 'ETH/BTC', side: 'BUY', type: 'MARKET' })).toHaveProperty(
            'message',
            `[STRATEGY] Impossible to create the BUY MARKET order on ETH/BTC: symbol must be one of the watched pairs (BTC/USDT, ETH/USDT), got ${quoted('ETH/BTC')}`,
          );
        });

        it('relays an order on any watched pair, not only the first', () => {
          manager.setMarketData(twoPairsMarketData);
          createOn({ symbol: 'ETH/USDT', side: 'BUY', type: 'LIMIT', amount: 1, price: 3000 });
          expect(listener).toHaveBeenCalledExactlyOnceWith({
            symbol: 'ETH/USDT',
            side: 'BUY',
            type: 'LIMIT',
            amount: 1,
            price: 3000,
            id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
            orderCreationDate: candle.start + ONE_MINUTE,
          });
        });
      });

      // The stop of a BUY was only checked once the BUY had completed: an invalid one was refused then, with a warning, and the position
      // the BUY had just opened kept no stop. One given to a SELL was dropped without a word.
      describe('with a trailing stop', () => {
        /** What a refused percentage, then a refused trigger, is told, the value shown as util.inspect shows it */
        const percentageIssue = (shown: string) =>
          `trailing.percentage must be a number above 0 and below 100 (2.5 for 2.5%), got ${shown}`;
        const triggerIssue = (shown: string) =>
          `trailing.trigger must be a price above 0, or left out for a stop active as soon as its BUY completes, got ${shown}`;
        const SELL_ISSUE = 'trailing applies to BUY orders only: its stop sells what the BUY filled';
        let listener: Mock;
        let failure: unknown;

        /** Creates a MARKET order of `side` on BTC/USDT asking for `trailing`, and returns what it throws */
        const createWith = (side: OrderSide, trailing: unknown) => {
          try {
            manager['createOrder']({ symbol: 'BTC/USDT', side, type: 'MARKET', trailing } as StrategyOrder);
          } catch (caught) {
            return caught;
          }
        };

        beforeEach(() => {
          listener = vi.fn();
          manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
        });

        describe.each`
          problem                                    | side      | trailing                                | reason
          ${'a BUY asks for a percentage of 0'}      | ${'BUY'}  | ${{ percentage: 0 }}                    | ${percentageIssue('0')}
          ${'a BUY asks for a percentage of 100'}    | ${'BUY'}  | ${{ percentage: 100 }}                  | ${percentageIssue('100')}
          ${'a BUY asks for a negative percentage'}  | ${'BUY'}  | ${{ percentage: -2 }}                   | ${percentageIssue('-2')}
          ${'a BUY asks for a percentage of NaN'}    | ${'BUY'}  | ${{ percentage: NaN }}                  | ${percentageIssue('NaN')}
          ${'a BUY asks for an infinite percentage'} | ${'BUY'}  | ${{ percentage: Infinity }}             | ${percentageIssue('Infinity')}
          ${'a BUY asks for a quoted percentage'}    | ${'BUY'}  | ${{ percentage: '2' }}                  | ${percentageIssue(quoted('2'))}
          ${'a BUY misspells its percentage'}        | ${'BUY'}  | ${{ percnt: 2 }}                        | ${percentageIssue('undefined')}
          ${'a BUY asks for a trigger of 0'}         | ${'BUY'}  | ${{ percentage: 2, trigger: 0 }}        | ${triggerIssue('0')}
          ${'a BUY asks for a negative trigger'}     | ${'BUY'}  | ${{ percentage: 2, trigger: -1 }}       | ${triggerIssue('-1')}
          ${'a BUY asks for a trigger of NaN'}       | ${'BUY'}  | ${{ percentage: 2, trigger: NaN }}      | ${triggerIssue('NaN')}
          ${'a BUY asks for an infinite trigger'}    | ${'BUY'}  | ${{ percentage: 2, trigger: Infinity }} | ${triggerIssue('Infinity')}
          ${'a BUY asks for a quoted trigger'}       | ${'BUY'}  | ${{ percentage: 2, trigger: '500' }}    | ${triggerIssue(quoted('500'))}
          ${'a SELL asks for a stop'}                | ${'SELL'} | ${{ percentage: 2 }}                    | ${SELL_ISSUE}
          ${'a SELL asks for a stop with a trigger'} | ${'SELL'} | ${{ percentage: 2, trigger: 50000 }}    | ${SELL_ISSUE}
        `('when $problem', ({ side, trailing, reason }) => {
          beforeEach(() => {
            failure = createWith(side, trailing);
          });

          it('refuses the order with a GekkoError', () => {
            expect(failure).toBeInstanceOf(GekkoError);
          });

          it('names the order and the field, and says what it accepts', () => {
            expect(failure).toHaveProperty('message', `[STRATEGY] Impossible to create the ${side} MARKET order on BTC/USDT: ${reason}`);
          });

          it('relays no order', () => {
            expect(listener).not.toHaveBeenCalled();
          });

          it('keeps no trailing stop', () => {
            expect(manager['pendingTrailingStops'].size).toBe(0);
          });
        });

        // A trigger left out, undefined (a strategy passing its own optional parameter) or null (an untyped one), asks for a stop active as
        // soon as its BUY completes, as the TrailingStopManager reads it
        describe.each`
          kind                            | trailing
          ${'a percentage'}               | ${{ percentage: 2 }}
          ${'a percentage and a trigger'} | ${{ percentage: 2, trigger: 50000 }}
          ${'a trigger left undefined'}   | ${{ percentage: 0.1, trigger: undefined }}
          ${'a trigger left null'}        | ${{ percentage: 99.9, trigger: null }}
        `('when a BUY asks for a stop with $kind', ({ trailing }) => {
          beforeEach(() => {
            failure = createWith('BUY', trailing);
          });

          it('accepts the order', () => {
            expect(failure).toBeUndefined();
          });

          it('relays the BUY without its trailing', () => {
            expect(listener).toHaveBeenCalledExactlyOnceWith({
              symbol: 'BTC/USDT',
              side: 'BUY',
              type: 'MARKET',
              id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
              orderCreationDate: candle.start + ONE_MINUTE,
            });
          });

          it('keeps its stop until the BUY completes', () => {
            expect(manager['pendingTrailingStops'].get('db2254e3-c749-448c-b7b6-aa28831bbae7')).toEqual(trailing);
          });
        });
      });
    });

    // The manager is driven as the TradingAdvisor drives it, one minute after the other, each completing its 1m candle, and the
    // strategy orders from one hook on one candle. init runs on the minute of candle 1, before that candle. Candle warmupPeriod + 1
    // completes the warmup (candle 1 without warmup): its warmup event comes after onEachTimeframeCandle, and before log and
    // onTimeframeCandleAfterWarmup.
    describe('createOrder during and after the warmup', () => {
      type CandleHook = 'init' | 'onEachTimeframeCandle' | 'log' | 'onTimeframeCandleAfterWarmup';
      const ORDER = { symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', amount: 1 } as const;
      const REFUSAL =
        '[STRATEGY] Orders are not available until the warmup is over: create them from onTimeframeCandleAfterWarmup, log or an order hook, never from init';
      /** The bucket of the minute `index` minutes after 0: in 1m, the timeframe candle it completes too */
      const minuteBucket = (index: number): CandleBucket => new Map([['BTC/USDT', { ...candle, start: index * ONE_MINUTE }]]);

      const createTheOrder = ({ tools }: { tools: Tools<object> }) => tools.createOrder(ORDER);

      let strategy: Record<CandleHook | 'onOrderCompleted', Mock>;
      let listener: Mock;
      let target: StrategyManager;

      const createTarget = (warmupPeriod: number) => {
        target = new StrategyManager(warmupPeriod);
        target.setMarketData(defaultMarketData);
        target['strategy'] = strategy as any;
        target.on(STRATEGY_CREATE_ORDER_EVENT, listener);
      };

      /** Sends the candles numbered `from` to `to` (from 1), each as its minute, then as the candle it completes */
      const sendCandles = (from: number, to: number) => {
        for (let candleNumber = from; candleNumber <= to; candleNumber++) {
          target.onOneMinuteBucket(minuteBucket(candleNumber - 1));
          target.onTimeFrameCandle(minuteBucket(candleNumber - 1));
        }
      };

      /** With a warmup of `warmupPeriod` candles, the strategy orders from `hook` on candle `candleNumber`: what that candle throws */
      const orderFrom = (hook: CandleHook, warmupPeriod: number, candleNumber: number) => {
        createTarget(warmupPeriod);
        sendCandles(1, candleNumber - 1);
        strategy[hook].mockImplementation(createTheOrder);
        try {
          sendCandles(candleNumber, candleNumber);
        } catch (failure) {
          return failure;
        }
      };

      beforeEach(() => {
        strategy = {
          init: vi.fn(),
          onEachTimeframeCandle: vi.fn(),
          log: vi.fn(),
          onTimeframeCandleAfterWarmup: vi.fn(),
          onOrderCompleted: vi.fn(),
        };
        listener = vi.fn();
      });

      describe.each`
        hook                       | warmupPeriod | candleNumber
        ${'init'}                  | ${3}         | ${1}
        ${'init'}                  | ${0}         | ${1}
        ${'onEachTimeframeCandle'} | ${3}         | ${1}
        ${'onEachTimeframeCandle'} | ${3}         | ${3}
        ${'onEachTimeframeCandle'} | ${3}         | ${4}
        ${'onEachTimeframeCandle'} | ${0}         | ${1}
      `(
        'when the strategy orders from $hook on candle $candleNumber, with a warmup of $warmupPeriod candles',
        ({ hook, warmupPeriod, candleNumber }) => {
          let failure: unknown;

          beforeEach(() => {
            failure = orderFrom(hook, warmupPeriod, candleNumber);
          });

          it('refuses the order with a GekkoError', () => {
            expect(failure).toBeInstanceOf(GekkoError);
          });

          it('says that orders are not available until the warmup is over, and from which hooks to create them', () => {
            expect(failure).toHaveProperty('message', REFUSAL);
          });

          it('relays no order', () => {
            expect(listener).not.toHaveBeenCalled();
          });
        },
      );

      describe.each`
        hook                              | warmupPeriod | candleNumber
        ${'log'}                          | ${3}         | ${4}
        ${'onTimeframeCandleAfterWarmup'} | ${3}         | ${4}
        ${'onTimeframeCandleAfterWarmup'} | ${3}         | ${5}
        ${'onEachTimeframeCandle'}        | ${3}         | ${5}
        ${'log'}                          | ${0}         | ${1}
        ${'onTimeframeCandleAfterWarmup'} | ${0}         | ${1}
        ${'onEachTimeframeCandle'}        | ${0}         | ${2}
      `(
        'when the strategy orders from $hook on candle $candleNumber, with a warmup of $warmupPeriod candles',
        ({ hook, warmupPeriod, candleNumber }) => {
          let failure: unknown;

          beforeEach(() => {
            failure = orderFrom(hook, warmupPeriod, candleNumber);
          });

          it('accepts the order', () => {
            expect(failure).toBeUndefined();
          });

          // Candle n is the minute starting n - 1 minutes after 0, and the clock is the end of the minute being processed
          it('relays the order, dated with the end of the minute that completed its candle', () => {
            expect(listener).toHaveBeenCalledExactlyOnceWith({
              ...ORDER,
              id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
              orderCreationDate: candleNumber * ONE_MINUTE,
            });
          });
        },
      );

      it('relays an order created from an order hook once the warmup is over', () => {
        createTarget(3);
        sendCandles(1, 4);
        strategy.onOrderCompleted.mockImplementation(createTheOrder);
        target.onOrderCompleted({ order: { id: 'db2254e3-c749-448c-b7b6-aa28831bbae7' }, exchange: {} } as any);
        expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(ORDER));
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

    describe('cancelTrailingOrder', () => {
      it('cancelTrailingOrder removes from pending orders and trailing stop manager', () => {
        const orderId = 'db2254e3-c749-448c-b7b6-aa28831bbae7' as UUID;

        manager['pendingTrailingStops'].set(orderId, { percentage: 2 });
        manager['trailingStopManager'].addOrder({
          id: orderId,
          symbol: 'BTC/USDT',
          amount: 1,
          trailing: { percentage: 2 },
          createdAt: 123456789,
        });

        expect(manager['pendingTrailingStops'].has(orderId)).toBe(true);
        expect(manager['trailingStopManager'].getOrders().has(orderId)).toBe(true);

        manager['cancelTrailingOrder'](orderId);

        expect(manager['pendingTrailingStops'].has(orderId)).toBe(false);
        expect(manager['trailingStopManager'].getOrders().has(orderId)).toBe(false);
      });
    });

    describe('log', () => {
      // A debug line went to winston, which formats a line before its level filter drops it, and was relayed to the strat_info
      // subscribers, whatever GEKKO_LOG_LEVEL: four a candle for MACD, most of the cost of a candle in a backtest, and as many Telegram
      // messages in realtime. The other levels are relayed whatever GEKKO_LOG_LEVEL, and a warning or an error always reaches the
      // logger, whose buffer keeps it for the log monitoring of Supervision.
      describe.each`
        level      | logger     | gekkoLogLevel | isLogged | relayed
        ${'debug'} | ${debug}   | ${'error'}    | ${false} | ${[]}
        ${'debug'} | ${debug}   | ${'info'}     | ${false} | ${[]}
        ${'debug'} | ${debug}   | ${'debug'}    | ${true}  | ${[]}
        ${'info'}  | ${info}    | ${'error'}    | ${true}  | ${['info']}
        ${'info'}  | ${info}    | ${'debug'}    | ${true}  | ${['info']}
        ${'warn'}  | ${warning} | ${'error'}    | ${true}  | ${['warn']}
        ${'warn'}  | ${warning} | ${'debug'}    | ${true}  | ${['warn']}
        ${'error'} | ${error}   | ${'error'}    | ${true}  | ${['error']}
        ${'error'} | ${error}   | ${'debug'}    | ${true}  | ${['error']}
      `('a $level line, with GEKKO_LOG_LEVEL $gekkoLogLevel', ({ level, logger, gekkoLogLevel, isLogged, relayed }) => {
        let listener: Mock;
        let failure: unknown;

        beforeEach(() => {
          setGekkoLogLevel(gekkoLogLevel);
          listener = vi.fn();
          manager.on(STRATEGY_INFO_EVENT, listener);
          failure = undefined;
          try {
            manager['log'](level, 'line');
          } catch (caught) {
            failure = caught;
          }
        });

        it(isLogged ? 'hands it to the logger' : 'does not hand it to the logger', () => {
          expect(vi.mocked(logger).mock.calls).toEqual(isLogged ? [['strategy', 'line']] : []);
        });

        it(relayed.length ? 'relays it, at its level' : 'does not relay it', () => {
          expect(listener.mock.calls.map(([strategyInfo]) => strategyInfo.level)).toEqual(relayed);
        });

        it(level === 'error' ? 'then throws a GekkoError' : 'does not throw', () => {
          expect(failure).toEqual(level === 'error' ? new GekkoError('strategy', 'line') : undefined);
        });
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

      // Thrown first, the error line was never relayed, even when the strategy caught the error and went on
      it('relays an error line before it throws', () => {
        const listener = vi.fn();
        manager.on(STRATEGY_INFO_EVENT, listener);
        try {
          manager['log']('error', 'Indicator out of range');
        } catch {
          // The throw has a test of its own
        }
        expect(listener).toHaveBeenCalledExactlyOnceWith({
          timestamp: manager['currentTimestamp'],
          level: 'error',
          tag: 'strategy',
          message: 'Indicator out of range',
        });
      });

      /** The warning about a level outside LogLevel, the level shown as util.inspect shows it */
      const unknownLevelWarning = (shown: string) =>
        `Unknown log level ${shown} in tools.log: its messages are logged and relayed at info level (levels: debug, info, warn, error)`;

      // Only an untyped strategy can pass these levels: Bun loads a strategyPath without type-checking it, and a JavaScript strategy has
      // no types. They logged nothing and were relayed as they were, 'ERROR' shown on Telegram as an error that stopped nothing.
      describe.each`
        level        | shown
        ${'warning'} | ${quoted('warning')}
        ${'ERROR'}   | ${quoted('ERROR')}
        ${undefined} | ${'undefined'}
      `('when the strategy logs twice at the unknown level $shown', ({ level, shown }) => {
        let listener: Mock;
        let failure: unknown;

        beforeEach(() => {
          listener = vi.fn();
          manager.on(STRATEGY_INFO_EVENT, listener);
          failure = undefined;
          try {
            manager['log'](level, 'first');
            manager['log'](level, 'second');
          } catch (caught) {
            failure = caught;
          }
        });

        it('does not throw', () => {
          expect(failure).toBeUndefined();
        });

        it('warns once, naming the level', () => {
          expect(vi.mocked(warning).mock.calls).toEqual([['strategy', unknownLevelWarning(shown)]]);
        });

        it('logs each message at info level', () => {
          expect(vi.mocked(info).mock.calls).toEqual([
            ['strategy', 'first'],
            ['strategy', 'second'],
          ]);
        });

        it('relays each message at info level', () => {
          expect(listener.mock.calls.map(([strategyInfo]) => strategyInfo.level)).toEqual(['info', 'info']);
        });
      });

      it('warns once for each unknown level', () => {
        manager['log']('warning' as LogLevel, 'first');
        manager['log']('ERROR' as LogLevel, 'second');
        manager['log']('warning' as LogLevel, 'third');
        expect(vi.mocked(warning).mock.calls.map(([, message]) => message)).toEqual([
          unknownLevelWarning(quoted('warning')),
          unknownLevelWarning(quoted('ERROR')),
        ]);
      });
    });
  });

  describe('utils function', () => {
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
