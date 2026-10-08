import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import type { Candle } from '@models/candle.types';
import type { CandleBucket } from '@models/event.types';
import type { LogLevel } from '@models/logLevel.types';
import type { OrderSide } from '@models/order.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { dummyExchangeSchema } from '@services/exchange/dummy/dummyCentralizedExchange.schema';
import type { MarketData } from '@services/exchange/exchange.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import type { GridBotStrategyParams } from './gridBot.types';
import * as GridBotUtils from './gridBot.utils';

const defaultParams: GridBotStrategyParams = {
  buyLevels: 2,
  sellLevels: 2,
  spacingType: 'fixed',
  spacingValue: 5,
  retryOnError: 3,
};

const marketDataMock: MarketData = {
  amount: { min: 0.1 },
  precision: { price: 0.01, amount: 0.01 },
};

const marketData = new Map([['BTC/USDT', marketDataMock]]);

const makeCandle = (close: number): CandleBucket => {
  const candle: Candle = {
    start: 0,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
  return new Map([['BTC/USDT', candle]]);
};

const balancedPortfolio: Portfolio = new Map<string, BalanceDetail>([
  ['BTC', { free: 5, used: 0, total: 5 }],
  ['USDT', { free: 500, used: 0, total: 500 }],
]);

const unbalancedPortfolio: Portfolio = new Map<string, BalanceDetail>([
  ['BTC', { free: 0, used: 0, total: 0 }],
  ['USDT', { free: 1000, used: 0, total: 1000 }],
]);

// The reasons of the order errors whose outcome is unknown, as the order layer and CCXTExchange word them
const lostOnTheNetwork =
  'Outcome unknown: the order may be live on the exchange, check it before placing it again ([EXCHANGE] binance POST https://api.binance.com/api/v3/order 504 Gateway Time-out)';
const answeredWithoutId =
  '[EXCHANGE] binance answered the creation of an order on BTC/USDT with neither a status nor an id: the order may exist on the exchange, but cannot be followed';

describe('GridBot', () => {
  let strategy: GridBot;
  let createOrder: ReturnType<typeof vi.fn>;
  let cancelOrder: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;
  let issuedOrders: Array<{ id: UUID; price: number; side: OrderSide; type: string; amount: number }>;
  let settledIds: Set<UUID>;
  let tools: any;

  beforeEach(() => {
    strategy = new GridBot();
    issuedOrders = [];
    settledIds = new Set();
    // As the StrategyManager's, which throws a GekkoError on 'error': with a log that returned, these tests ran code after it that a
    // real run never reached
    log = vi.fn((level: LogLevel, message: string) => {
      if (level === 'error') throw new GekkoError('strategy', message);
    });
    cancelOrder = vi.fn();
    createOrder = vi.fn(order => {
      const id = `order-${issuedOrders.length + 1}` as UUID;
      issuedOrders.push({ id, price: order.price ?? 0, side: order.side, type: order.type, amount: order.amount });
      return id;
    });
    // tools should simulate the structure expected by the strategy
    tools = { strategyParams: defaultParams, marketData, createOrder, cancelOrder, log, pairs: ['BTC/USDT'] };
  });

  const initStrategy = (price = 100, params: Partial<GridBotStrategyParams> = {}, portfolio: Portfolio = balancedPortfolio) => {
    tools.strategyParams = { ...defaultParams, ...params };
    strategy.init({
      candle: makeCandle(price),
      portfolio,
      tools,
      addIndicator: vi.fn(),
    });
  };

  /** A candle after the warmup: the first one starts the grid around its close */
  const afterWarmup = (price: number, portfolio: Portfolio = balancedPortfolio) =>
    strategy.onTimeframeCandleAfterWarmup({ candle: makeCandle(price), portfolio, tools });

  /** A run without warmup: its first candle, which init receives, is also the first after the warmup */
  const startStrategy = (price = 100, params: Partial<GridBotStrategyParams> = {}, portfolio: Portfolio = balancedPortfolio) => {
    initStrategy(price, params, portfolio);
    afterWarmup(price, portfolio);
  };

  /** Runs a step that stops the run, as tools.log('error') does, to look at what it did before */
  const untilStopped = (step: () => void) => {
    try {
      step();
    } catch (err) {
      if (!(err instanceof GekkoError)) throw err;
    }
  };

  const findOrderId = (price: number, side: OrderSide): UUID | undefined =>
    issuedOrders.find(order => order.price === price && order.side === side)?.id;

  /** The order a level holds now at that price and side: a level armed or placed again gets a new order at the same price */
  const liveOrder = (price: number, side: OrderSide) => issuedOrders.findLast(order => order.price === price && order.side === side);

  /**
   * Delivers the outcome of the live order at that price and side, as the Trader reports it: a cancel with nothing filled and an
   * error 'Test error', unless `details` say otherwise
   */
  const settle = (
    outcome: 'completed' | 'canceled' | 'errored',
    price: number,
    side: OrderSide,
    details: { filled?: number; remaining?: number; reason?: string } = {},
  ) => {
    const { id, amount } = liveOrder(price, side) ?? {};
    const order = { id, symbol: 'BTC/USDT', side, type: 'LIMIT', amount, price } as any;
    const exchange = { price, portfolio: balancedPortfolio };
    settledIds.add(order.id);
    if (outcome === 'completed') strategy.onOrderCompleted({ order, exchange, tools });
    if (outcome === 'canceled')
      strategy.onOrderCanceled({ order: { ...order, filled: 0, remaining: amount, ...details }, exchange, tools });
    if (outcome === 'errored') strategy.onOrderErrored({ order: { ...order, reason: 'Test error', ...details }, exchange, tools });
  };

  /** The orders sent and not settled, as `side price` from the lowest price: the book the exchange holds */
  const openBook = () =>
    issuedOrders
      .filter(({ id }) => !settledIds.has(id))
      .sort((a, b) => a.price - b.price || a.side.localeCompare(b.side))
      .map(({ side, price }) => `${side} ${price}`);

  /** The orders sent once `count` had been, as `type side price` */
  const sentAfter = (count: number) => issuedOrders.slice(count).map(({ type, side, price }) => `${type} ${side} ${price}`);

  /** The orders sent once `count` had been, as `side price xamount` */
  const amountsSentAfter = (count: number) => issuedOrders.slice(count).map(({ side, price, amount }) => `${side} ${price} x${amount}`);

  // GridBot placed its grid from init, on the first candle of the warmup: in realtime a candle of the history replayed at start-up,
  // so the Trader sent live a grid centred on a stale close, a year old with 365 daily candles
  describe('warmup', () => {
    const balancedAt130: Portfolio = new Map<string, BalanceDetail>([
      ['BTC', { free: 5, used: 0, total: 5 }],
      ['USDT', { free: 650, used: 0, total: 650 }],
    ]);

    it.each`
      portfolio              | description
      ${balancedPortfolio}   | ${'a balanced portfolio, which gets its grid'}
      ${unbalancedPortfolio} | ${'an unbalanced portfolio, which gets its rebalance'}
    `('places no order from init, with $description', ({ portfolio }) => {
      initStrategy(100, {}, portfolio);

      expect(createOrder).not.toHaveBeenCalled();
    });

    it('places no order on a candle of the warmup', () => {
      initStrategy(100);
      strategy.onEachTimeframeCandle({ candle: makeCandle(130), portfolio: balancedPortfolio, tools });

      expect(createOrder).not.toHaveBeenCalled();
    });

    it('warns of no price out of range on a candle of the warmup, the grid not being placed yet', () => {
      initStrategy(100);
      strategy.onEachTimeframeCandle({ candle: makeCandle(150), portfolio: balancedPortfolio, tools });

      expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });

    it('places the grid around the close of the first candle after the warmup, not around the close init received', () => {
      initStrategy(100, {}, balancedAt130);
      afterWarmup(130, balancedAt130);

      expect(issuedOrders.map(({ side, price }) => `${side} ${price}`)).toEqual(['BUY 120', 'BUY 125', 'SELL 135', 'SELL 140']);
    });

    it('plans the rebalance at the close of the first candle after the warmup', () => {
      initStrategy(100, {}, unbalancedPortfolio);
      afterWarmup(200, unbalancedPortfolio);

      expect(createOrder.mock.calls).toEqual([[{ type: 'STICKY', side: 'BUY', amount: 2.5, symbol: 'BTC/USDT' }]]);
    });

    it('sizes on the portfolio of the first candle after the warmup, not on the one init received', () => {
      initStrategy(100, {}, unbalancedPortfolio);
      afterWarmup(100, balancedPortfolio);

      expect(issuedOrders.map(({ side, type }) => `${side} ${type}`)).toEqual(['BUY LIMIT', 'BUY LIMIT', 'SELL LIMIT', 'SELL LIMIT']);
    });

    it('starts the grid once: a later candle after the warmup places no other order', () => {
      startStrategy(100);
      afterWarmup(130);

      expect(createOrder).toHaveBeenCalledTimes(4);
    });
  });

  describe('grid placement', () => {
    it('places correct number of orders for balanced portfolio', () => {
      startStrategy(100);

      expect(createOrder).toHaveBeenCalledTimes(4);
    });

    it.each`
      buyLevels | sellLevels | expectedOrders
      ${1}      | ${1}       | ${2}
      ${2}      | ${2}       | ${4}
      ${3}      | ${2}       | ${5}
      ${2}      | ${3}       | ${5}
    `('places $expectedOrders orders for $buyLevels buy and $sellLevels sell levels', ({ buyLevels, sellLevels, expectedOrders }) => {
      // Create portfolio balanced for this level ratio
      // Target asset ratio = sellLevels / (buyLevels + sellLevels)
      const totalValue = 1000;
      const assetRatio = sellLevels / (buyLevels + sellLevels);
      const assetValue = totalValue * assetRatio;
      const assetAmount = assetValue / 100; // at price 100
      const currencyValue = totalValue - assetValue;

      const balancedForLevels: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: assetAmount, used: 0, total: assetAmount }],
        ['USDT', { free: currencyValue, used: 0, total: currencyValue }],
      ]);

      startStrategy(100, { buyLevels, sellLevels }, balancedForLevels);

      expect(createOrder).toHaveBeenCalledTimes(expectedOrders);
    });

    it('places buy orders below center price', () => {
      startStrategy(100);

      const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
      expect(buyOrders.every(o => o.price < 100)).toBe(true);
    });

    it('places sell orders above center price', () => {
      startStrategy(100);

      const sellOrders = issuedOrders.filter(o => o.side === 'SELL');
      expect(sellOrders.every(o => o.price > 100)).toBe(true);
    });

    it('uses LIMIT order type for grid orders', () => {
      startStrategy(100);

      expect(issuedOrders.every(o => o.type === 'LIMIT')).toBe(true);
    });
  });

  describe('rebalancing', () => {
    it('places STICKY rebalance order for unbalanced portfolio', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it('uses correct side for rebalance when asset value is low', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      expect(issuedOrders[0].type).toBe('STICKY');
    });

    it('builds grid after rebalance completion', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCompleted({
        order: { id: rebalanceId, side: 'BUY' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });

    it('retries rebalance on error', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(2);
    });

    it('builds grid if rebalance no longer needed after error', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      // Simulate error but with a balanced portfolio (e.g. price moved or partial fill logic not tracked here, but state update)
      // Actually strictly speaking onOrderErrored uses the portfolio from exchange.
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      // Should skip retry and build grid immediately
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Retrying'));
      // But since no rebalance needed, it builds grid (4 orders)
      expect(createOrder).toHaveBeenCalledTimes(5); // 1 initial sticky + 4 grid orders (no retry sticky)
    });

    it('handles rebalance order cancellation', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCanceled({
        order: { id: rebalanceId } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('failed'));
    });

    // A rebalance used to be planned and placed again whatever the error: one lost on the network may be live on the exchange,
    // untracked, and both filled, the portfolio was rebalanced twice
    describe('when the outcome of the rebalance order is unknown', () => {
      const loseRebalance = () =>
        strategy.onOrderErrored({
          order: { id: issuedOrders[0].id, reason: lostOnTheNetwork } as any,
          exchange: { price: 100, portfolio: unbalancedPortfolio },
          tools,
        });

      it('stops the run, the grid not built', () => {
        startStrategy(100, {}, unbalancedPortfolio);

        expect(loseRebalance).toThrow(
          `GridBot: The rebalance, a STICKY BUY of 5, may be live on the exchange without GridBot tracking it: the grid is not built. Check it on the exchange. Last error: ${lostOnTheNetwork}`,
        );
      });

      it('does not place the rebalance again', () => {
        startStrategy(100, {}, unbalancedPortfolio);
        untilStopped(loseRebalance);

        expect(issuedOrders.map(({ type, side }) => `${type} ${side}`)).toEqual(['STICKY BUY']);
      });
    });

    // The grid used to be built anyway on the portfolio as it was, after a tools.log('error') that had already stopped the run: these
    // tests ran that code with a log that returned
    describe('once the rebalance failed at every attempt', () => {
      // Short of BTC for the grid, yet with both sides funded: built without the rebalance, the grid would have 4 levels of 1.5 BTC
      const shortOfAssetPortfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 3, used: 0, total: 3 }],
        ['USDT', { free: 1000, used: 0, total: 1000 }],
      ]);

      /** Ends the live rebalance order `times` times in a row, as the Trader reports it, the portfolio left as it was */
      const failRebalance = (times: number, outcome: 'errored' | 'canceled') => {
        for (let i = 0; i < times; i++) {
          const order = { id: issuedOrders[issuedOrders.length - 1].id, reason: 'Test error' } as any;
          const exchange = { price: 100, portfolio: shortOfAssetPortfolio };
          if (outcome === 'errored') strategy.onOrderErrored({ order, exchange, tools });
          else strategy.onOrderCanceled({ order, exchange, tools });
        }
      };

      it.each`
        outcome       | retryOnError | attempts | reason
        ${'errored'}  | ${1}         | ${2}     | ${'Test error'}
        ${'errored'}  | ${3}         | ${4}     | ${'Test error'}
        ${'canceled'} | ${3}         | ${4}     | ${'Order was canceled'}
      `(
        'stops the run once $attempts attempts in a row are $outcome, with retryOnError $retryOnError',
        ({ outcome, retryOnError, attempts, reason }) => {
          startStrategy(100, { retryOnError }, shortOfAssetPortfolio);

          expect(() => failRebalance(attempts, outcome)).toThrow(
            `GridBot: Rebalance failed after ${attempts} attempts (retryOnError: ${retryOnError}): the grid is not built. Last error: ${reason}`,
          );
        },
      );

      it('places the rebalance again until its last attempt', () => {
        startStrategy(100, { retryOnError: 3 }, shortOfAssetPortfolio);

        expect(() => failRebalance(3, 'errored')).not.toThrow();
      });

      it('builds no grid on the portfolio as it is: the orders sent are the attempts of the rebalance', () => {
        startStrategy(100, { retryOnError: 3 }, shortOfAssetPortfolio);
        untilStopped(() => failRebalance(4, 'errored'));

        expect(issuedOrders.map(({ type, side }) => `${type} ${side}`)).toEqual(['STICKY BUY', 'STICKY BUY', 'STICKY BUY', 'STICKY BUY']);
      });
    });

    // The rebalance, planned on the total balances, is more than the free balances can pay: the grid is built without it, on the free
    // balances, which fund no level here
    describe('when the free balances cannot pay for the rebalance', () => {
      // Wants to buy 500 USDT of BTC, 10 USDT free
      const lockedCurrency: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['USDT', { free: 10, used: 990, total: 1000 }],
      ]);
      // Wants to sell 5 BTC, 0.1 BTC free
      const lockedAsset: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0.1, used: 9.9, total: 10 }],
        ['USDT', { free: 0, used: 0, total: 0 }],
      ]);
      // Wants to buy 25 USDT of BTC, 10 USDT free
      const lowCurrency: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['USDT', { free: 10, used: 0, total: 50 }],
      ]);

      it.each`
        portfolio         | description                          | warning
        ${lockedCurrency} | ${'currency locked in other orders'} | ${'Insufficient currency'}
        ${lockedAsset}    | ${'asset locked in other orders'}    | ${'Insufficient asset'}
        ${lowCurrency}    | ${'too little free currency'}        | ${'Insufficient currency'}
      `('warns that it skips the rebalance, with $description', ({ portfolio, warning }) => {
        untilStopped(() => startStrategy(100, {}, portfolio));

        expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(warning));
      });

      it.each`
        portfolio         | description
        ${lockedCurrency} | ${'currency locked in other orders'}
        ${lockedAsset}    | ${'asset locked in other orders'}
        ${lowCurrency}    | ${'too little free currency'}
      `('sends no order, with $description', ({ portfolio }) => {
        untilStopped(() => startStrategy(100, {}, portfolio));

        expect(createOrder).not.toHaveBeenCalled();
      });

      it.each`
        portfolio         | description
        ${lockedCurrency} | ${'currency locked in other orders'}
        ${lockedAsset}    | ${'asset locked in other orders'}
        ${lowCurrency}    | ${'too little free currency'}
      `('stops the run, the free balances funding no level, with $description', ({ portfolio }) => {
        expect(() => startStrategy(100, {}, portfolio)).toThrow('GridBot: Insufficient portfolio for any grid levels');
      });
    });
  });

  describe('validation', () => {
    it.each`
      price  | params                                                      | expectedError
      ${0}   | ${{}}                                                       | ${'GridBot: Center price must be positive'}
      ${100} | ${{ buyLevels: 25, spacingType: 'fixed', spacingValue: 5 }} | ${'GridBot: Grid configuration would result in non-positive buy prices'}
    `('stops the run with $expectedError', ({ price, params, expectedError }) => {
      expect(() => startStrategy(price, params)).toThrow(expectedError);
    });

    it('stops the run if the grid bounds cannot be computed', () => {
      vi.spyOn(GridBotUtils, 'computeGridBounds').mockReturnValue(null);

      expect(() => startStrategy(100)).toThrow('GridBot: Could not compute valid grid bounds');
    });

    // GridBot used to go on after tools.log('error'), as if it had only logged
    it('stops the run on its own, with a log that would return at error level', () => {
      log.mockImplementation(() => undefined);

      expect(() => startStrategy(0)).toThrow('GridBot: Center price must be positive');
    });
  });

  describe('order completion', () => {
    // These two used to check only that no order had disappeared, which held whatever the fill did: it armed nothing, BUY 95 and
    // SELL 105 being each other's neighbour across the center price
    it.each`
      side      | price  | expected
      ${'BUY'}  | ${95}  | ${['LIMIT SELL 100']}
      ${'SELL'} | ${105} | ${['LIMIT BUY 100']}
    `('arms the opposite side one step away, at the center price, after a $side fill at $price', ({ side, price, expected }) => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('completed', price, side);

      expect(sentAfter(sentBefore)).toEqual(expected);
    });

    it('logs warning when only one side remains', () => {
      startStrategy(100, { buyLevels: 1, sellLevels: 1 });

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCompleted({
        order: { id: buyId as UUID, side: 'BUY' } as any,
        exchange: { price: 95, portfolio: balancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('one side'));
    });

    it('ignores unknown order IDs', () => {
      startStrategy(100);

      const initialCalls = createOrder.mock.calls.length;
      strategy.onOrderCompleted({
        order: { id: 'unknown-id' as UUID, side: 'BUY' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(initialCalls);
    });
  });

  // A fill armed the neighbouring level, and only if it held no order: a neighbour whose own fill was not reported yet was skipped.
  // A drop through several BUYs re-armed when a backtest reported the fills highest first, not when paper or live trading polled
  // them lowest first, so a backtest kept a grid that paper and live trading lost
  describe('levels filled together', () => {
    const afterDrop = ['SELL 90', 'SELL 95', 'SELL 100', 'SELL 105', 'SELL 110', 'SELL 115'];
    const afterRally = ['BUY 85', 'BUY 90', 'BUY 95', 'BUY 100', 'BUY 105', 'BUY 110'];

    it.each`
      side      | prices             | book
      ${'BUY'}  | ${[95, 90, 85]}    | ${afterDrop}
      ${'BUY'}  | ${[95, 85, 90]}    | ${afterDrop}
      ${'BUY'}  | ${[90, 95, 85]}    | ${afterDrop}
      ${'BUY'}  | ${[90, 85, 95]}    | ${afterDrop}
      ${'BUY'}  | ${[85, 95, 90]}    | ${afterDrop}
      ${'BUY'}  | ${[85, 90, 95]}    | ${afterDrop}
      ${'SELL'} | ${[105, 110, 115]} | ${afterRally}
      ${'SELL'} | ${[105, 115, 110]} | ${afterRally}
      ${'SELL'} | ${[110, 105, 115]} | ${afterRally}
      ${'SELL'} | ${[110, 115, 105]} | ${afterRally}
      ${'SELL'} | ${[115, 105, 110]} | ${afterRally}
      ${'SELL'} | ${[115, 110, 105]} | ${afterRally}
    `('re-arms the fills of $side $prices, reported in that order, into the same book', ({ side, prices, book }) => {
      startStrategy(100, { buyLevels: 3, sellLevels: 3 });
      prices.forEach((price: number) => settle('completed', price, side));

      expect(openBook()).toEqual(book);
    });

    it.each`
      prices
      ${[90, 95, 100]}
      ${[100, 95, 90]}
    `('places the initial grid again once the price comes back through SELL $prices, reported in that order', ({ prices }) => {
      startStrategy(100, { buyLevels: 3, sellLevels: 3 });
      [85, 90, 95].forEach(price => settle('completed', price, 'BUY'));
      prices.forEach((price: number) => settle('completed', price, 'SELL'));

      expect(openBook()).toEqual(['BUY 85', 'BUY 90', 'BUY 95', 'SELL 105', 'SELL 110', 'SELL 115']);
    });
  });

  // The two levels next to the center price were each other's neighbours, two steps apart, and each held its order, so the first
  // fill on either side armed nothing: a price swinging between the center and one step away traded once, then never again
  describe('around the center price', () => {
    const assetOnlyPortfolio: Portfolio = new Map<string, BalanceDetail>([
      ['BTC', { free: 10, used: 0, total: 10 }],
      ['USDT', { free: 0, used: 0, total: 0 }],
    ]);

    // A one-sided grid wants the whole portfolio on its side: no rebalance
    it.each`
      grid           | buyLevels | sellLevels | portfolio              | side      | price  | expected
      ${'buy-only'}  | ${3}      | ${0}       | ${unbalancedPortfolio} | ${'BUY'}  | ${95}  | ${['LIMIT SELL 100']}
      ${'sell-only'} | ${0}      | ${3}       | ${assetOnlyPortfolio}  | ${'SELL'} | ${105} | ${['LIMIT BUY 100']}
    `(
      'arms the center price after the first fill of a $grid grid, $side $price',
      ({ buyLevels, sellLevels, portfolio, side, price, expected }) => {
        startStrategy(100, { buyLevels, sellLevels }, portfolio);
        const sentBefore = issuedOrders.length;
        settle('completed', price, side);

        expect(sentAfter(sentBefore)).toEqual(expected);
      },
    );

    it('trades every swing between the center price and one step below it', () => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('completed', 95, 'BUY');
      settle('completed', 100, 'SELL');
      settle('completed', 95, 'BUY');
      settle('completed', 100, 'SELL');

      expect(sentAfter(sentBefore)).toEqual(['LIMIT SELL 100', 'LIMIT BUY 95', 'LIMIT SELL 100', 'LIMIT BUY 95']);
    });

    // One candle, or one poll interval, through both levels: each takes the center price on its other side, and the one the market
    // has passed fills next
    it.each`
      first         | fills
      ${'BUY 95'}   | ${[[95, 'BUY'], [105, 'SELL']]}
      ${'SELL 105'} | ${[[105, 'SELL'], [95, 'BUY']]}
    `('arms the center price on both sides once BUY 95 and SELL 105 fill together, $first reported first', ({ fills }) => {
      startStrategy(100);
      fills.forEach(([price, side]: [number, OrderSide]) => settle('completed', price, side));

      expect(openBook()).toEqual(['BUY 90', 'BUY 100', 'SELL 100', 'SELL 110']);
    });

    it('places the initial grid again once both orders at the center price fill', () => {
      startStrategy(100);
      settle('completed', 95, 'BUY');
      settle('completed', 105, 'SELL');
      settle('completed', 100, 'SELL');
      settle('completed', 100, 'BUY');

      expect(openBook()).toEqual(['BUY 90', 'BUY 95', 'SELL 105', 'SELL 110']);
    });
  });

  describe('order errors', () => {
    it('retries order on error', () => {
      startStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderErrored({
        order: { id: buyId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });
  });

  // A level whose order failed at every attempt gave up through tools.log('error'), which throws: the first one stopped the bot, with
  // a message naming an array index rather than the order
  describe('a grid order that failed at every attempt', () => {
    /** Ends the live order at that price and side in error `times` times in a row, as the Trader reports it */
    const fail = (times: number, price: number, side: OrderSide) => {
      for (let i = 0; i < times; i++) settle('errored', price, side);
    };

    it.each`
      side      | price  | retryOnError | attempts
      ${'BUY'}  | ${95}  | ${1}         | ${2}
      ${'BUY'}  | ${95}  | ${3}         | ${4}
      ${'SELL'} | ${105} | ${3}         | ${4}
    `(
      'warns that the $side at $price failed after $attempts attempts, with retryOnError $retryOnError',
      ({ side, price, retryOnError, attempts }) => {
        startStrategy(100, { retryOnError });
        fail(attempts, price, side);

        expect(log).toHaveBeenCalledWith(
          'warn',
          `GridBot: ${side} at ${price} failed after ${attempts} attempts (retryOnError: ${retryOnError}): its level is left without an order, the rest of the grid trades on. Last error: Test error`,
        );
      },
    );

    it('does not stop the run while other levels hold an order', () => {
      startStrategy(100, { retryOnError: 3 });

      expect(() => fail(4, 95, 'BUY')).not.toThrow();
    });

    it('is placed again after every attempt but the last', () => {
      startStrategy(100, { retryOnError: 3 });
      const sentBefore = issuedOrders.length;
      fail(4, 95, 'BUY');

      expect(sentAfter(sentBefore)).toEqual(['LIMIT BUY 95', 'LIMIT BUY 95', 'LIMIT BUY 95']);
    });

    it('leaves its level without an order, the rest of the book in place', () => {
      startStrategy(100, { retryOnError: 3 });
      fail(4, 95, 'BUY');

      expect(openBook()).toEqual(['BUY 90', 'SELL 105', 'SELL 110']);
    });

    it('lets the rest of the grid trade on: the fill of the BUY below arms its SELL', () => {
      startStrategy(100, { retryOnError: 3 });
      fail(4, 95, 'BUY');
      const sentBefore = issuedOrders.length;
      settle('completed', 90, 'BUY');

      expect(sentAfter(sentBefore)).toEqual(['LIMIT SELL 95']);
    });

    // A grid without any order would sit idle for the rest of the run
    it.each`
      grid     | buyLevels | sellLevels | portfolio              | failing                         | last
      ${'1/0'} | ${1}      | ${0}       | ${unbalancedPortfolio} | ${[[95, 'BUY']]}                | ${'BUY at 95'}
      ${'1/1'} | ${1}      | ${1}       | ${balancedPortfolio}   | ${[[95, 'BUY'], [105, 'SELL']]} | ${'SELL at 105'}
    `('stops the run once no level of a $grid grid holds an order any more', ({ buyLevels, sellLevels, portfolio, failing, last }) => {
      startStrategy(100, { buyLevels, sellLevels, retryOnError: 1 }, portfolio);

      expect(() => failing.forEach(([price, side]: [number, OrderSide]) => fail(2, price, side))).toThrow(
        `GridBot: ${last} failed after 2 attempts (retryOnError: 1): no level of the grid holds an order any more. Last error: Test error`,
      );
    });
  });

  describe('order cancellation', () => {
    it('replaces canceled grid order', () => {
      startStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCanceled({
        order: { id: buyId as UUID } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });
  });

  // A canceled order was placed again for the whole quantity, its attempts counted from 0 again: what had filled before the cancel
  // was traded a second time, and an exchange that kept canceling it (self-trade prevention, a cancel by hand) brought it back
  // without end
  describe('a grid order canceled', () => {
    // 2.5 per level: the 2/2 grid at 100 on 5 BTC and 500 USDT. 2.5 - 2.2 is 0.2999999999999998 in binary
    it.each`
      side      | price  | cancels                                                             | description                                      | expected
      ${'BUY'}  | ${95}  | ${[{ filled: 0, remaining: 2.5 }]}                                  | ${'nothing filled'}                              | ${['BUY 95 x2.5']}
      ${'BUY'}  | ${95}  | ${[{ filled: 1, remaining: 1.5 }]}                                  | ${'1 filled'}                                    | ${['BUY 95 x1.5']}
      ${'BUY'}  | ${95}  | ${[{ filled: 1, remaining: 0 }]}                                    | ${'1 filled, its remaining amount not reported'} | ${['BUY 95 x1.5']}
      ${'SELL'} | ${105} | ${[{ filled: 0.5, remaining: 2 }]}                                  | ${'0.5 filled'}                                  | ${['SELL 105 x2']}
      ${'BUY'}  | ${95}  | ${[{ filled: 2.2, remaining: 0.3 }]}                                | ${'2.2 filled'}                                  | ${['BUY 95 x0.3']}
      ${'BUY'}  | ${95}  | ${[{ filled: 0.3, remaining: 2.2 }, { filled: 0.2, remaining: 2 }]} | ${'0.3 filled, then 0.2 of the rest'}            | ${['BUY 95 x2.2', 'BUY 95 x2']}
    `('places again what is left of $side $price, $description: $expected', ({ side, price, cancels, expected }) => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      cancels.forEach((cancel: { filled: number; remaining: number }) => settle('canceled', price, side, cancel));

      expect(amountsSentAfter(sentBefore)).toEqual(expected);
    });

    // Order.applyOrderUpdate hands on a fill and a remaining amount the exchange did not report as 0
    it('places again whole an order canceled with neither its fill nor its remaining amount reported', () => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('canceled', 95, 'BUY', { filled: 0, remaining: 0 });

      expect(amountsSentAfter(sentBefore)).toEqual(['BUY 95 x2.5']);
    });

    it('warns that an order canceled with neither its fill nor its remaining amount reported is placed again whole', () => {
      startStrategy(100);
      settle('canceled', 95, 'BUY', { filled: 0, remaining: 0 });

      expect(log).toHaveBeenCalledWith(
        'warn',
        'GridBot: BUY at 95 was canceled with neither its fill nor its remaining amount reported: it is placed again whole, 2.5, which trades again any part of it that had filled',
      );
    });

    it('turns its level to the other side once the cancel reports it filled in full, as a fill does', () => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('canceled', 95, 'BUY', { filled: 2.5, remaining: 0 });

      expect(amountsSentAfter(sentBefore)).toEqual(['SELL 100 x2.5']);
    });

    describe('again and again', () => {
      /** Cancels the live order at that price and side `times` times in a row, nothing filled */
      const cancel = (times: number, price: number, side: OrderSide) => {
        for (let i = 0; i < times; i++) settle('canceled', price, side);
      };

      it.each`
        side      | price  | retryOnError | attempts
        ${'BUY'}  | ${95}  | ${1}         | ${2}
        ${'BUY'}  | ${95}  | ${3}         | ${4}
        ${'SELL'} | ${105} | ${3}         | ${4}
      `(
        'warns that the $side at $price failed after $attempts cancels, with retryOnError $retryOnError',
        ({ side, price, retryOnError, attempts }) => {
          startStrategy(100, { retryOnError });
          cancel(attempts, price, side);

          expect(log).toHaveBeenCalledWith(
            'warn',
            `GridBot: ${side} at ${price} failed after ${attempts} attempts (retryOnError: ${retryOnError}): its level is left without an order, the rest of the grid trades on. Last error: Order was canceled (filled: 0, remaining: 2.5)`,
          );
        },
      );

      it('is placed again after every cancel but the last', () => {
        startStrategy(100, { retryOnError: 3 });
        const sentBefore = issuedOrders.length;
        cancel(4, 95, 'BUY');

        expect(sentAfter(sentBefore)).toEqual(['LIMIT BUY 95', 'LIMIT BUY 95', 'LIMIT BUY 95']);
      });

      it('counts the cancels and the refusals of an order together', () => {
        startStrategy(100, { retryOnError: 3 });
        ['canceled', 'errored', 'canceled', 'errored'].forEach(outcome => settle(outcome as 'canceled' | 'errored', 95, 'BUY'));

        expect(log).toHaveBeenCalledWith(
          'warn',
          'GridBot: BUY at 95 failed after 4 attempts (retryOnError: 3): its level is left without an order, the rest of the grid trades on. Last error: Test error',
        );
      });

      it('counts the attempts from 0 again once the level fills', () => {
        startStrategy(100, { retryOnError: 3 });
        cancel(3, 95, 'BUY');
        settle('completed', 95, 'BUY');
        cancel(3, 100, 'SELL');

        expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('failed after'));
      });

      // One candle, or one poll interval, through BUY 95 and SELL 105 arms a SELL and a BUY at the center price. Should the market
      // sit there, an exchange preventing self-trades (Binance expires the maker by default) cancels each in turn as the other is
      // placed again: the cancels count, and both levels give up
      it('stops placing again a SELL and a BUY at the center price that the exchange cancels in turn', () => {
        startStrategy(100, { retryOnError: 3 });
        settle('completed', 95, 'BUY');
        settle('completed', 105, 'SELL');
        const sentBefore = issuedOrders.length;
        for (let i = 0; i < 4; i++) {
          settle('canceled', 100, 'SELL');
          settle('canceled', 100, 'BUY');
        }

        expect(sentAfter(sentBefore)).toEqual(Array.from({ length: 3 }, () => ['LIMIT SELL 100', 'LIMIT BUY 100']).flat());
      });
    });
  });

  // Every error placed the order again, an "Outcome unknown" one too: the order lost on the network may be live on the exchange,
  // where nothing tracks it any more, so it was doubled, two lots bought or sold where the level holds one, or the copy was refused
  // for want of the reserve the first one holds
  describe('a grid order whose outcome is unknown', () => {
    it.each`
      reason               | description
      ${lostOnTheNetwork}  | ${'a creation lost on the network'}
      ${answeredWithoutId} | ${'a creation answered with neither a status nor an id'}
    `('is not placed again after $description', ({ reason }) => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('errored', 95, 'BUY', { reason });

      expect(sentAfter(sentBefore)).toEqual([]);
    });

    it('warns that it may be live on the exchange, untracked, its level left without an order', () => {
      startStrategy(100);
      settle('errored', 95, 'BUY', { reason: lostOnTheNetwork });

      expect(log).toHaveBeenCalledWith(
        'warn',
        `GridBot: BUY 2.5 at 95 may be live on the exchange without GridBot tracking it: it is not placed again, its level is left without an order, the rest of the grid trades on. Check it there. Last error: ${lostOnTheNetwork}`,
      );
    });

    it('leaves its level without an order, the rest of the book in place', () => {
      startStrategy(100);
      settle('errored', 95, 'BUY', { reason: lostOnTheNetwork });

      expect(openBook()).toEqual(['BUY 90', 'SELL 105', 'SELL 110']);
    });

    it('lets the rest of the grid trade on: the fill of the BUY below arms its SELL', () => {
      startStrategy(100);
      settle('errored', 95, 'BUY', { reason: lostOnTheNetwork });
      const sentBefore = issuedOrders.length;
      settle('completed', 90, 'BUY');

      expect(sentAfter(sentBefore)).toEqual(['LIMIT SELL 95']);
    });

    // 1.66 per level: the 3/3 grid at 100 on 5 BTC and 500 USDT
    it('does not stop the run while retryOnError orders or fewer may be live untracked', () => {
      startStrategy(100, { buyLevels: 3, sellLevels: 3, retryOnError: 3 });

      expect(() => [95, 90, 85].forEach(price => settle('errored', price, 'BUY', { reason: lostOnTheNetwork }))).not.toThrow();
    });

    it('stops the run once more orders than retryOnError may be live untracked, naming them', () => {
      startStrategy(100, { buyLevels: 3, sellLevels: 3, retryOnError: 3 });
      const loseFour = () => {
        [95, 90, 85].forEach(price => settle('errored', price, 'BUY', { reason: lostOnTheNetwork }));
        settle('errored', 105, 'SELL', { reason: lostOnTheNetwork });
      };

      expect(loseFour).toThrow(
        `GridBot: BUY 1.66 at 95, BUY 1.66 at 90, BUY 1.66 at 85, SELL 1.66 at 105 may be live on the exchange without GridBot tracking them: 4 orders, more than retryOnError (3). Check them on the exchange. Last error: ${lostOnTheNetwork}`,
      );
    });

    // All in currency, as a buy-only grid wants it: no rebalance, 10.52 on the one level
    it('stops the run once no level of the grid holds an order any more', () => {
      startStrategy(100, { buyLevels: 1, sellLevels: 0 }, unbalancedPortfolio);

      expect(() => settle('errored', 95, 'BUY', { reason: lostOnTheNetwork })).toThrow(
        `GridBot: BUY 10.52 at 95 may be live on the exchange without GridBot tracking it, and no level of the grid holds an order any more. Check it on the exchange. Last error: ${lostOnTheNetwork}`,
      );
    });
  });

  describe('a grid order refused', () => {
    it.each`
      reason                                                                                                | source
      ${'[EXCHANGE] Insufficient currency balance (portfolio: 60, order cost: 190)'}                        | ${'the simulated exchange'}
      ${'[EXCHANGE] binance {"code":-2010,"msg":"Account has insufficient balance for requested action."}'} | ${'a real exchange'}
      ${new OrderOutOfRangeError('exchange', 'amount', 0.001, 0.01).message}                                | ${'the limits of the market'}
      ${'no price known for BTC/USDT'}                                                                      | ${'the Trader'}
    `('is placed again after a refusal from $source', ({ reason }) => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('errored', 95, 'BUY', { reason });

      expect(sentAfter(sentBefore)).toEqual(['LIMIT BUY 95']);
    });

    it('is placed again for the amount refused: what a cancel after a partial fill left of it', () => {
      startStrategy(100);
      const sentBefore = issuedOrders.length;
      settle('canceled', 95, 'BUY', { filled: 1, remaining: 1.5 });
      settle('errored', 95, 'BUY');

      expect(amountsSentAfter(sentBefore)).toEqual(['BUY 95 x1.5', 'BUY 95 x1.5']);
    });
  });

  // A fill arms a level on the opposite side, but the level kept the side the grid was built with: a canceled or errored order
  // came back on that side, the SELL armed below the center as a BUY above the market, the BUY armed above it as a SELL below the
  // market. The one-side warning read the same stale sides
  describe('a level armed on the opposite side by a fill', () => {
    // BUY 95 and BUY 90 fill and turn their levels to SELL 100 and SELL 95; the mirror above the center: SELL 105 and SELL 110 fill
    // and turn theirs to BUY 100 and BUY 105
    const sellArmedAt95 = [
      [95, 'BUY'],
      [90, 'BUY'],
    ];
    const buyArmedAt105 = [
      [105, 'SELL'],
      [110, 'SELL'],
    ];

    it.each`
      fills            | side      | price  | outcomes                   | then                        | expected
      ${sellArmedAt95} | ${'SELL'} | ${95}  | ${['canceled']}            | ${'canceled'}               | ${['LIMIT SELL 95']}
      ${buyArmedAt105} | ${'BUY'}  | ${105} | ${['canceled']}            | ${'canceled'}               | ${['LIMIT BUY 105']}
      ${sellArmedAt95} | ${'SELL'} | ${95}  | ${['errored']}             | ${'errored'}                | ${['LIMIT SELL 95']}
      ${buyArmedAt105} | ${'BUY'}  | ${105} | ${['errored']}             | ${'errored'}                | ${['LIMIT BUY 105']}
      ${sellArmedAt95} | ${'SELL'} | ${95}  | ${['canceled', 'errored']} | ${'canceled, then errored'} | ${['LIMIT SELL 95', 'LIMIT SELL 95']}
    `('places the order a fill armed, $side $price, again on its side once $then', ({ fills, side, price, outcomes, expected }) => {
      startStrategy(100);
      fills.forEach(([fillPrice, fillSide]: [number, OrderSide]) => settle('completed', fillPrice, fillSide));
      const sentBefore = issuedOrders.length;
      outcomes.forEach((outcome: 'canceled' | 'errored') => settle(outcome, price, side));

      expect(issuedOrders.slice(sentBefore).map(order => `${order.type} ${order.side} ${order.price}`)).toEqual(expected);
    });

    it.each`
      fills            | book
      ${sellArmedAt95} | ${'SELL 95, 100, 105 and 110'}
      ${buyArmedAt105} | ${'BUY 90, 95, 100 and 105'}
    `('warns that only one side remains once the fills leave $book', ({ fills }) => {
      startStrategy(100);
      fills.forEach(([price, side]: [number, OrderSide]) => settle('completed', price, side));

      expect(log).toHaveBeenCalledWith('warn', 'GridBot: Only one side of the grid remains active');
    });

    it('does not warn once the fills of a buy-only grid leave BUY 85 and SELL 95 and 100', () => {
      // All in currency, as a buy-only grid wants it: no rebalance
      startStrategy(100, { buyLevels: 3, sellLevels: 0 }, unbalancedPortfolio);
      settle('completed', 95, 'BUY');
      settle('completed', 90, 'BUY');

      expect(log).not.toHaveBeenCalledWith('warn', 'GridBot: Only one side of the grid remains active');
    });
  });

  describe('out of range', () => {
    it('logs warning when price exits grid range', () => {
      startStrategy(100);

      strategy.onEachTimeframeCandle({
        candle: makeCandle(150),
        portfolio: balancedPortfolio,
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });

    it('does not log when price is in range', () => {
      startStrategy(100);

      strategy.onEachTimeframeCandle({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools,
      });

      expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });
  });

  describe('spacing types', () => {
    it.each`
      spacingType      | spacingValue | expectedBuyPrice | expectedSellPrice
      ${'fixed'}       | ${5}         | ${95}            | ${105}
      ${'percent'}     | ${5}         | ${95}            | ${105}
      ${'logarithmic'} | ${0.05}      | ${95.24}         | ${105}
    `('calculates correct prices for $spacingType spacing', ({ spacingType, spacingValue, expectedBuyPrice, expectedSellPrice }) => {
      startStrategy(100, { spacingType, spacingValue, buyLevels: 1, sellLevels: 1 });

      const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
      const sellOrders = issuedOrders.filter(o => o.side === 'SELL');

      expect(buyOrders[0]?.price).toBe(expectedBuyPrice);
      expect(sellOrders[0]?.price).toBe(expectedSellPrice);
    });
  });

  // A backtest's market data, parsed by the dummy-cex schema from the configuration of config/backtest.yml and the documentation,
  // whose precision is 8 decimals. Handed on as steps of 8, it rounded the grid prices to multiples of 8 and these amounts, below
  // 1 BTC, to 0: GridBot stopped the backtest at its first candle after warmup ('Insufficient portfolio for any grid levels').
  describe('with the market data of the documented dummy-cex configuration', () => {
    const { marketData: configuredMarketData } = dummyExchangeSchema.parse({
      name: 'dummy-cex',
      simulationBalance: [{ assetName: 'USDT', balance: 1000 }],
      marketData: [
        {
          symbol: 'BTC/USDT',
          marketData: {
            price: { min: 0.01, max: 1_000_000 },
            amount: { min: 0.00001, max: 9000 },
            cost: { min: 5, max: 9_000_000 },
            precision: { price: 8, amount: 8 },
            fee: { maker: 0.0004, taker: 0.0007 },
          },
        },
      ],
    });
    const percentGrid = { spacingType: 'percent', spacingValue: 1 } as const;

    beforeEach(() => {
      tools.marketData = configuredMarketData;
    });

    it('rebalances the documented portfolio, 1000 USDT and no BTC, with a STICKY BUY of half of it rounded down to 8 decimals', () => {
      startStrategy(61234.56, { ...percentGrid, buyLevels: 5, sellLevels: 5 }, unbalancedPortfolio);

      expect(createOrder.mock.calls).toEqual([[{ type: 'STICKY', side: 'BUY', amount: 0.00816532, symbol: 'BTC/USDT' }]]);
    });

    it('places a balanced grid 1 % around the close, its prices and amounts to 8 decimals', () => {
      const portfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0.05, used: 0, total: 0.05 }],
        ['USDT', { free: 3000, used: 0, total: 3000 }],
      ]);
      startStrategy(61234.56, { ...percentGrid, buyLevels: 1, sellLevels: 1 }, portfolio);

      expect(createOrder.mock.calls).toEqual([
        [{ type: 'LIMIT', side: 'BUY', amount: 0.0494868, price: 60622.2144, symbol: 'BTC/USDT' }],
        [{ type: 'LIMIT', side: 'SELL', amount: 0.0494868, price: 61846.9056, symbol: 'BTC/USDT' }],
      ]);
    });
  });
});
