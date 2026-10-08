import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { ONE_MINUTE } from '@constants/time.const';
import { ApplicationStopError } from '@errors/applicationStop.error';
import { StrategyOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { Timeframe, Watch } from '@models/configuration.types';
import {
  CandleBucket,
  ExchangeEvent,
  OrderCanceledEvent,
  OrderCompletedEvent,
  OrderErroredEvent,
  OrderInitiatedEvent,
} from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { Exchange, MarketData } from '@services/exchange/exchange.types';
import { error } from '@services/logger';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { toTimestamp } from '@utils/date/date.utils';
import { UUID } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TradingAdvisor } from './tradingAdvisor';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';

// The advisor runs on the real StrategyManager, only the strategy is a double. Its hooks are these spies, through which a test
// scripts what the strategy does (tools.createOrder, tools.cancelOrder, tools.log) and reads what the strategy was given.
const { strategy, TestStrategy } = vi.hoisted(() => {
  const strategy = {
    init: vi.fn<(params: InitParams<object>) => void>(),
    onEachTimeframeCandle: vi.fn<(params: OnCandleEventParams<object>, ...indicators: IndicatorResults[]) => void>(),
    onTimeframeCandleAfterWarmup: vi.fn<(params: OnCandleEventParams<object>, ...indicators: IndicatorResults[]) => void>(),
    onOrderCompleted: vi.fn<(params: OnOrderCompletedEventParams<object>) => void>(),
    onOrderCanceled: vi.fn<(params: OnOrderCanceledEventParams<object>) => void>(),
    onOrderErrored: vi.fn<(params: OnOrderErroredEventParams<object>) => void>(),
    end: vi.fn<() => void>(),
  };
  class TestStrategy implements Strategy<object> {
    init = strategy.init;
    onEachTimeframeCandle = strategy.onEachTimeframeCandle;
    onTimeframeCandleAfterWarmup = strategy.onTimeframeCandleAfterWarmup;
    onOrderCompleted = strategy.onOrderCompleted;
    onOrderCanceled = strategy.onOrderCanceled;
    onOrderErrored = strategy.onOrderErrored;
    end = strategy.end;
  }
  return { strategy, TestStrategy };
});

// The real registry answers undefined for a name it does not export, a module mock throws: MissingStrategy plays that name
vi.mock('@strategies/index', () => ({ TestStrategy, MissingStrategy: undefined }));
vi.mock('@services/configuration/configuration', () => ({ config: { getWatch: vi.fn(), getStrategy: vi.fn() } }));
vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// A midnight (UTC), so that the first bucket sent opens a candle of every timeframe used here
const START = toTimestamp('2025-01-01T00:00:00.000Z');
const BASE_PRICES = new Map<TradingPair, number>([
  ['BTC/USDT', 100],
  ['ETH/USDT', 200],
]);

/** The bucket of the minute starting `minute` minutes after START: the prices of every pair rise by 1 a minute from its base price. */
const oneMinuteBucket = (minute: number): CandleBucket =>
  new Map(
    [...BASE_PRICES].map(([pair, basePrice]): [TradingPair, Candle] => {
      const price = basePrice + minute;
      return [pair, { start: START + minute * ONE_MINUTE, open: price, high: price + 2, low: price - 2, close: price + 1, volume: 1 }];
    }),
  );

/** The 3m bucket made of the first three one-minute buckets: first open, highest high, lowest low, last close, total volume. */
const FIRST_3M_BUCKET: CandleBucket = new Map([
  ['BTC/USDT', { start: START, open: 100, high: 104, low: 98, close: 103, volume: 3 }],
  ['ETH/USDT', { start: START, open: 200, high: 204, low: 198, close: 203, volume: 3 }],
]);

const watch = (timeframe: Timeframe, warmupCandleCount: number): Watch => ({
  assets: ['BTC', 'ETH'],
  currency: 'USDT',
  pairs: [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }],
  timeframe,
  tickrate: 1000,
  mode: 'backtest',
  warmup: { tickrate: 1000, candleCount: warmupCandleCount },
});

const MARKET_DATA = new Map<TradingPair, MarketData>([
  ['BTC/USDT', { amount: { min: 0.0001 }, price: { min: 0.01 } }],
  ['ETH/USDT', { amount: { min: 0.001 }, price: { min: 0.1 } }],
]);

const usdtPortfolio = (total: number): Portfolio => new Map([['USDT', { free: total, used: 0, total }]]);
const FETCHED_BALANCE = usdtPortfolio(1000);

// All that processInit asks of the exchange
const exchange: Pick<Exchange, 'getMarketData' | 'fetchBalance'> = {
  getMarketData: symbol => MARKET_DATA.get(symbol) ?? {},
  fetchBalance: async () => FETCHED_BALANCE,
};

const ORDER_IDS: UUID[] = ['3b0e8a52-4c1d-4f6e-9a7b-2d5c8e1f0a01', '3b0e8a52-4c1d-4f6e-9a7b-2d5c8e1f0a02'];
const ORDER = { symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', amount: 1, price: 100, orderCreationDate: START } as const;
const EXCHANGE_EVENT: ExchangeEvent = { portfolio: FETCHED_BALANCE, price: 100 };

const orderCompleted = (id: UUID): OrderCompletedEvent => ({
  order: { ...ORDER, id, orderExecutionDate: START, effectivePrice: 100, fee: 0.1, feePercent: 0.1 },
  exchange: EXCHANGE_EVENT,
});
const orderCanceled = (id: UUID): OrderCanceledEvent => ({
  order: { ...ORDER, id, orderCancelationDate: START, filled: 0, remaining: 1 },
  exchange: EXCHANGE_EVENT,
});
const orderErrored = (id: UUID): OrderErroredEvent => ({
  order: { ...ORDER, id, orderErrorDate: START, reason: 'Insufficient balance' },
  exchange: EXCHANGE_EVENT,
});

/** A batch of order events of one kind, one per id of ORDER_IDS, in that order. */
const batchOf = <T>(orderEvent: (id: UUID) => T) => ORDER_IDS.map(id => orderEvent(id));

/** An event of `orderEvent`'s kind for each portfolio, in that order, with the ids of ORDER_IDS: the portfolio the Trader read after it */
const carrying = <T extends OrderInitiatedEvent>(orderEvent: (id: UUID) => T, ...portfolios: Portfolio[]): T[] =>
  portfolios.map((portfolio, index) => ({ ...orderEvent(ORDER_IDS[index]), exchange: { portfolio, price: 100 } }));

// Each order handler of the advisor, sent a batch of its own kind of events
const SEND_ORDER_BATCH = {
  onOrderCompleted: (advisor: TradingAdvisor) => advisor.onOrderCompleted(batchOf(orderCompleted)),
  onOrderCanceled: (advisor: TradingAdvisor) => advisor.onOrderCanceled(batchOf(orderCanceled)),
  onOrderErrored: (advisor: TradingAdvisor) => advisor.onOrderErrored(batchOf(orderErrored)),
};

const BUY_ORDER: StrategyOrder = { symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', amount: 1 };
const ORDER_TO_CANCEL: UUID = '3b0e8a52-4c1d-4f6e-9a7b-2d5c8e1f0a03';
const INFO_MESSAGE = 'Buying BTC';

// What the advisor queues, in the order getStaticConfiguration declares it
const EMITTED_EVENTS = [
  STRATEGY_INFO_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type StaticConfiguration = ReturnType<typeof TradingAdvisor.getStaticConfiguration>;

type AdvisorOptions = Partial<{
  timeframe: Timeframe;
  warmupCandleCount: number;
  maxConsecutiveErrors: number;
  strategyName: string;
  strategyPath: string;
}>;

/** An advisor set up as the pipeline does it: built from its parsed configuration, then given the exchange it asks for. */
const createAdvisor = ({
  timeframe = '3m',
  warmupCandleCount = 0,
  maxConsecutiveErrors = 5,
  strategyName = 'TestStrategy',
  strategyPath,
}: AdvisorOptions = {}) => {
  vi.mocked(config.getWatch).mockReturnValue(watch(timeframe, warmupCandleCount));
  const advisor = new TradingAdvisor({ name: 'TradingAdvisor', strategyName, strategyPath, maxConsecutiveErrors });
  advisor.setExchange(exchange as Exchange);
  return advisor;
};

const startAdvisor = async (options?: AdvisorOptions) => {
  const advisor = createAdvisor(options);
  await advisor.processInitStream();
  return advisor;
};

/** Sends the advisor the `count` consecutive one-minute buckets from START, one at a time as PluginsStream does. */
const sendBuckets = async (advisor: TradingAdvisor, count: number) => {
  for (let minute = 0; minute < count; minute++) await advisor.processInputStream(oneMinuteBucket(minute));
};

/** Broadcasts what the advisor queued, as PluginsStream does after a bucket, and returns the payloads delivered for each event. */
const flushDeferredEvents = async (advisor: TradingAdvisor) => {
  const delivered = new Map<string, unknown[]>();
  for (const event of EMITTED_EVENTS) {
    advisor.on<unknown[]>(event, payloads => {
      delivered.set(event, [...(delivered.get(event) ?? []), ...payloads]);
    });
  }
  while (await advisor.broadcastDeferredEmit()) {
    // Until the queue is empty
  }
  return delivered;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TradingAdvisor', () => {
  describe('getStaticConfiguration', () => {
    it.each`
      property            | expected
      ${'name'}           | ${'TradingAdvisor'}
      ${'schema'}         | ${tradingAdvisorSchema}
      ${'modes'}          | ${['realtime', 'backtest']}
      ${'dependencies'}   | ${[]}
      ${'inject'}         | ${['exchange']}
      ${'eventsHandlers'} | ${['onOrderCompleted', 'onOrderCanceled', 'onOrderErrored', 'onPortfolioChange']}
      ${'eventsEmitted'}  | ${EMITTED_EVENTS}
    `('declares its $property', ({ property, expected }: { property: keyof StaticConfiguration; expected: unknown }) => {
      expect(TradingAdvisor.getStaticConfiguration()[property]).toEqual(expected);
    });
  });

  describe('processInit', () => {
    it.each`
      source                    | strategyName         | strategyPath                                      | message
      ${'the strategies index'} | ${'MissingStrategy'} | ${undefined}                                      | ${'Cannot find internal MissingStrategy strategy'}
      ${'its strategyPath'}     | ${'TestStrategy'}    | ${resolve(__dirname, 'tradingAdvisor.schema.ts')} | ${'Cannot find external TestStrategy strategy'}
    `('rejects when $source does not export the strategy', async ({ strategyName, strategyPath, message }) => {
      await expect(createAdvisor({ strategyName, strategyPath }).processInitStream()).rejects.toThrow(message);
    });

    describe('on the first timeframe candle', () => {
      beforeEach(async () => {
        await sendBuckets(await startAdvisor(), 3);
      });

      it.each`
        given                                      | expected
        ${'the market data of every watched pair'} | ${expect.objectContaining({ tools: expect.objectContaining({ marketData: MARKET_DATA }) })}
        ${'the balance fetched from the exchange'} | ${expect.objectContaining({ portfolio: FETCHED_BALANCE })}
      `('gives the strategy $given', ({ expected }) => {
        expect(strategy.init).toHaveBeenCalledExactlyOnceWith(expected);
      });
    });
  });

  describe('processOneMinuteBucket', () => {
    it.each`
      timeframe | bucketCount | candleCount
      ${'1m'}   | ${1}        | ${1}
      ${'1m'}   | ${3}        | ${3}
      ${'3m'}   | ${2}        | ${0}
      ${'3m'}   | ${3}        | ${1}
      ${'3m'}   | ${6}        | ${2}
      ${'1h'}   | ${59}       | ${0}
      ${'1h'}   | ${60}       | ${1}
    `(
      'sends the strategy the $timeframe candles completed by $bucketCount one-minute buckets',
      async ({ timeframe, bucketCount, candleCount }) => {
        await sendBuckets(await startAdvisor({ timeframe }), bucketCount);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledTimes(candleCount);
      },
    );

    it('queues no event before the timeframe candle is complete', async () => {
      const advisor = await startAdvisor();
      await sendBuckets(advisor, 2);
      expect(await flushDeferredEvents(advisor)).toEqual(new Map());
    });

    it('queues only the timeframe candle while the strategy warms up', async () => {
      strategy.onTimeframeCandleAfterWarmup.mockImplementation(({ tools }) => tools.log('info', INFO_MESSAGE));
      const advisor = await startAdvisor({ warmupCandleCount: 1 });
      await sendBuckets(advisor, 3);
      const delivered = await flushDeferredEvents(advisor);
      expect([...delivered.keys()]).toEqual([TIMEFRAME_CANDLE_EVENT]);
    });

    it('rejects when the strategy logs an error', async () => {
      strategy.onEachTimeframeCandle.mockImplementation(({ tools }) => tools.log('error', 'Indicator out of range'));
      const advisor = await startAdvisor();
      await expect(sendBuckets(advisor, 3)).rejects.toThrow('Indicator out of range');
    });

    // Thrown before it was relayed, the error line was lost even to a strategy that caught the error and went on
    it('queues the error line of a strategy that catches the error and goes on', async () => {
      strategy.onEachTimeframeCandle.mockImplementation(({ tools }) => {
        try {
          tools.log('error', 'Indicator out of range');
        } catch {
          // The strategy goes on
        }
      });
      const advisor = await startAdvisor();
      await sendBuckets(advisor, 3);
      const delivered = await flushDeferredEvents(advisor);
      expect(delivered.get(STRATEGY_INFO_EVENT)).toEqual([
        { timestamp: START + 3 * ONE_MINUTE, level: 'error', tag: 'strategy', message: 'Indicator out of range' },
      ]);
    });

    // In realtime the warmup candles are history, replayed with the Trader active: an order created on them is refused, which stops
    // the run before the Trader hears of it
    it.each`
      hook
      ${'init'}
      ${'onEachTimeframeCandle'}
    `(
      'rejects when the strategy creates an order from $hook during the warmup',
      async ({ hook }: { hook: 'init' | 'onEachTimeframeCandle' }) => {
        strategy[hook].mockImplementation(({ tools }) => {
          tools.createOrder(BUY_ORDER);
        });
        const advisor = await startAdvisor({ warmupCandleCount: 1 });
        await expect(sendBuckets(advisor, 3)).rejects.toThrow('[STRATEGY] Orders are not available until the warmup is over');
      },
    );

    describe('on a complete timeframe candle after the warmup', () => {
      let createdOrderId: UUID | undefined;
      let delivered: Map<string, unknown[]>;

      beforeEach(async () => {
        createdOrderId = undefined;
        strategy.onTimeframeCandleAfterWarmup.mockImplementation(({ tools }) => {
          createdOrderId = tools.createOrder(BUY_ORDER);
          tools.cancelOrder(ORDER_TO_CANCEL);
          tools.log('info', INFO_MESSAGE);
        });
        const advisor = await startAdvisor();
        await sendBuckets(advisor, 3);
        delivered = await flushDeferredEvents(advisor);
      });

      it('sends the strategy the bucket aggregated over the timeframe', () => {
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ candle: FIRST_3M_BUCKET }));
      });

      // The last bucket starts at START + 2 min: the strategy's clock is its close, START + 3 min, which dates the order as the Trader
      // and the simulated exchange date the fills and the errors of that bucket
      it('queues the order the strategy created', () => {
        expect(delivered.get(STRATEGY_CREATE_ORDER_EVENT)).toEqual([
          { ...BUY_ORDER, id: createdOrderId, orderCreationDate: START + 3 * ONE_MINUTE },
        ]);
      });

      it.each`
        event                              | expected
        ${STRATEGY_CANCEL_ORDER_EVENT}     | ${[ORDER_TO_CANCEL]}
        ${STRATEGY_INFO_EVENT}             | ${[{ timestamp: START + 3 * ONE_MINUTE, level: 'info', tag: 'strategy', message: INFO_MESSAGE }]}
        ${STRATEGY_WARMUP_COMPLETED_EVENT} | ${[FIRST_3M_BUCKET]}
        ${TIMEFRAME_CANDLE_EVENT}          | ${[FIRST_3M_BUCKET]}
      `('queues $event', ({ event, expected }) => {
        expect(delivered.get(event)).toEqual(expected);
      });
    });
  });

  describe('order events', () => {
    it.each`
      handler
      ${'onOrderCompleted'}
      ${'onOrderCanceled'}
      ${'onOrderErrored'}
    `('$handler gives the strategy every order of the batch, in order', async ({ handler }: { handler: keyof typeof SEND_ORDER_BATCH }) => {
      await SEND_ORDER_BATCH[handler](await startAdvisor());
      expect(strategy[handler].mock.calls.map(([{ order }]) => order.id)).toEqual(ORDER_IDS);
    });

    it('onOrderErrored rejects with ApplicationStopError once a batch reaches maxConsecutiveErrors', async () => {
      const advisor = await startAdvisor({ maxConsecutiveErrors: ORDER_IDS.length });
      await expect(SEND_ORDER_BATCH.onOrderErrored(advisor)).rejects.toThrow(ApplicationStopError);
    });

    // Thrown before the strategy's hook, the circuit breaker kept the error that trips it from the strategy
    it('onOrderErrored gives the strategy the order that trips the circuit breaker too', async () => {
      const advisor = await startAdvisor({ maxConsecutiveErrors: ORDER_IDS.length });
      await SEND_ORDER_BATCH.onOrderErrored(advisor).catch(() => undefined);
      expect(strategy.onOrderErrored.mock.calls.map(([{ order }]) => order.id)).toEqual(ORDER_IDS);
    });
  });

  describe('onPortfolioChange', () => {
    it('gives the strategy the last portfolio of the batch', async () => {
      const advisor = await startAdvisor();
      advisor.onPortfolioChange([usdtPortfolio(900), usdtPortfolio(800)]);
      await sendBuckets(advisor, 3);
      expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ portfolio: usdtPortfolio(800) }));
    });
  });

  // Only a portfolio change refreshed the portfolio of the candle hooks, and the Trader's portfolioUpdates filter holds that back for a
  // fill below its threshold: they kept the balance from before the fill, and an all-in order sized on it was refused
  describe('the portfolio an order event carries', () => {
    it.each`
      handler               | orderEvent
      ${'onOrderCompleted'} | ${orderCompleted}
      ${'onOrderCanceled'}  | ${orderCanceled}
      ${'onOrderErrored'}   | ${orderErrored}
    `(
      '$handler gives the next candle the portfolio the last event of its batch carries',
      async ({ handler, orderEvent }: { handler: keyof typeof SEND_ORDER_BATCH; orderEvent: (id: UUID) => OrderCompletedEvent }) => {
        const advisor = await startAdvisor();
        await advisor[handler](carrying(orderEvent, usdtPortfolio(900), usdtPortfolio(800)) as never);
        await sendBuckets(advisor, 3);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ portfolio: usdtPortfolio(800) }));
      },
    );

    // Until one of its synchronizations succeeds, the Trader relays the end of an order with the empty portfolio it starts with
    it.each`
      handler               | orderEvent
      ${'onOrderCompleted'} | ${orderCompleted}
      ${'onOrderCanceled'}  | ${orderCanceled}
      ${'onOrderErrored'}   | ${orderErrored}
    `(
      '$handler leaves the next candle the portfolio it had when its event carries the empty one of a Trader yet to fetch any',
      async ({ handler, orderEvent }: { handler: keyof typeof SEND_ORDER_BATCH; orderEvent: (id: UUID) => OrderCompletedEvent }) => {
        const advisor = await startAdvisor();
        await advisor[handler](carrying(orderEvent, new Map()) as never);
        await sendBuckets(advisor, 3);
        expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ portfolio: FETCHED_BALANCE }));
      },
    );

    // Each in the order the Trader queued it: the last one received is the latest it read
    const portfolioChangeThenEnd = async (advisor: TradingAdvisor) => {
      advisor.onPortfolioChange([usdtPortfolio(900)]);
      await advisor.onOrderCompleted(carrying(orderCompleted, usdtPortfolio(800)));
    };
    const endThenPortfolioChange = async (advisor: TradingAdvisor) => {
      await advisor.onOrderCompleted(carrying(orderCompleted, usdtPortfolio(800)));
      advisor.onPortfolioChange([usdtPortfolio(900)]);
    };

    it.each`
      received                                          | send                      | expected
      ${'a portfolio change, then the end of an order'} | ${portfolioChangeThenEnd} | ${usdtPortfolio(800)}
      ${'the end of an order, then a portfolio change'} | ${endThenPortfolioChange} | ${usdtPortfolio(900)}
    `('gives the next candle the last portfolio received, after $received', async ({ send, expected }) => {
      const advisor = await startAdvisor();
      await send(advisor);
      await sendBuckets(advisor, 3);
      expect(strategy.onEachTimeframeCandle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ portfolio: expected }));
    });
  });

  // What the strategy received was the engine's own object, which the other plugins, the exchange or the configuration held too
  describe('when the strategy writes to what it receives', () => {
    describe('to its candles', () => {
      let delivered: Map<string, unknown[]>;

      beforeEach(async () => {
        strategy.onEachTimeframeCandle.mockImplementation(({ candle }) => {
          candle.get('BTC/USDT')!.close = 0;
          candle.delete('ETH/USDT');
        });
        // Without warmup the first candle completes it: its warmup event is queued after onEachTimeframeCandle
        const advisor = await startAdvisor();
        await sendBuckets(advisor, 3);
        delivered = await flushDeferredEvents(advisor);
      });

      it.each`
        event
        ${STRATEGY_WARMUP_COMPLETED_EVENT}
        ${TIMEFRAME_CANDLE_EVENT}
      `('queues $event with the bucket as the batcher built it', ({ event }) => {
        expect(delivered.get(event)).toEqual([FIRST_3M_BUCKET]);
      });
    });

    it('leaves the portfolio the other plugins received as it was', async () => {
      const portfolio = usdtPortfolio(800);
      strategy.onEachTimeframeCandle.mockImplementation(({ portfolio: own }) => {
        own.get('USDT')!.free = 0;
      });
      const advisor = await startAdvisor();
      advisor.onPortfolioChange([portfolio]);
      await sendBuckets(advisor, 3);
      expect(portfolio).toEqual(usdtPortfolio(800));
    });

    it('leaves the portfolio of an order event, which the other plugins received too, as it was', async () => {
      const [event] = carrying(orderCompleted, usdtPortfolio(800));
      strategy.onEachTimeframeCandle.mockImplementation(({ portfolio: own }) => {
        own.get('USDT')!.free = 0;
      });
      const advisor = await startAdvisor();
      await advisor.onOrderCompleted([event]);
      await sendBuckets(advisor, 3);
      expect(event.exchange.portfolio).toEqual(usdtPortfolio(800));
    });

    it.each`
      handler               | orderEvent
      ${'onOrderCompleted'} | ${orderCompleted}
      ${'onOrderCanceled'}  | ${orderCanceled}
      ${'onOrderErrored'}   | ${orderErrored}
    `(
      '$handler leaves the events of the batch, which the other plugins receive after it, as they were',
      async ({ handler, orderEvent }: { handler: keyof typeof SEND_ORDER_BATCH; orderEvent: (id: UUID) => OrderCompletedEvent }) => {
        // Each event with a portfolio of its own
        const batch = () => batchOf(id => ({ ...orderEvent(id), exchange: { portfolio: usdtPortfolio(1000), price: 100 } }));
        (strategy[handler] as Mock).mockImplementation(({ order, exchange }: { order: { amount: number }; exchange: ExchangeEvent }) => {
          order.amount = 0;
          exchange.portfolio.clear();
        });
        const sent = batch();
        await (await startAdvisor())[handler](sent as never);
        expect(sent).toEqual(batch());
      },
    );

    it('leaves the market data of the exchange as it was', async () => {
      const entry: MarketData = { amount: { min: 0.0001 }, fee: { maker: 0.001, taker: 0.001 } };
      strategy.init.mockImplementation(({ tools }) => {
        tools.marketData.get('BTC/USDT')!.fee!.taker = 0;
      });
      // As dummy-cex and paper trading do, the exchange hands out its own entry, the one its simulator charges fees with
      const ownEntryExchange: Pick<Exchange, 'getMarketData' | 'fetchBalance'> = { ...exchange, getMarketData: () => entry };
      const advisor = createAdvisor();
      advisor.setExchange(ownEntryExchange as Exchange);
      await advisor.processInitStream();
      await sendBuckets(advisor, 3);
      expect(entry).toEqual({ amount: { min: 0.0001 }, fee: { maker: 0.001, taker: 0.001 } });
    });

    // Every plugin keeps the block: the PerformanceReporter makes its run id of it
    it('leaves the strategy block of the configuration as it was', async () => {
      vi.mocked(config.getStrategy).mockReturnValue({ name: 'TestStrategy', thresholds: { up: 1 } });
      strategy.init.mockImplementation(({ tools }) => {
        (tools.strategyParams as { thresholds: { up: number } }).thresholds.up = 9;
      });
      await sendBuckets(await startAdvisor(), 3);
      expect(config.getStrategy()).toEqual({ name: 'TestStrategy', thresholds: { up: 1 } });
    });

    // Two 3m candles closing at 103 and 106: the ribbon of an EMA(1) and an EMA(2) is ready on the second one
    it('leaves the results of an indicator as it computed them', async () => {
      strategy.init.mockImplementation(({ addIndicator }) => addIndicator('EMARibbon', 'BTC/USDT', { count: 2, start: 1, step: 1 }));
      strategy.onEachTimeframeCandle.mockImplementation((_params, ribbon) => {
        (ribbon.results as { results: number[] } | null)?.results.reverse();
      });
      const advisor = await startAdvisor();
      await sendBuckets(advisor, 6);
      const [{ indicator }] = advisor['strategyManager']!['indicators'];
      expect(indicator.getResult()).toEqual({ results: [106, 104.5], spread: 1.5 });
    });
  });

  describe('processFinalize', () => {
    it('ends the strategy', async () => {
      const advisor = await startAdvisor();
      await advisor.processCloseStream();
      expect(strategy.end).toHaveBeenCalledOnce();
    });

    // With a warmup of one 3m candle, the second one completes it: a run that ended before used to say nothing about it
    it.each`
      bucketCount | errors
      ${3}        | ${[['strategy', 'Strategy ended before its warmup was over, so it never traded: 1 timeframe candle(s) processed, 2 needed (warmup.candleCount: 1, then one to trade on)']]}
      ${6}        | ${[]}
    `('logs $errors.length error(s) when the run ends after $bucketCount one-minute buckets', async ({ bucketCount, errors }) => {
      const advisor = await startAdvisor({ warmupCandleCount: 1 });
      await sendBuckets(advisor, bucketCount);
      await advisor.processCloseStream();
      expect(vi.mocked(error).mock.calls).toEqual(errors);
    });
  });
});
