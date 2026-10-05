import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { OrderSide } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { DUMMY_CANDLE_BUFFER_SIZE, DUMMY_CANDLE_BUFFER_TRIM_MARGIN, LIMITS } from '@services/exchange/exchange.const';
import { InvalidOrder } from '@services/exchange/exchange.error';
import { MarketData } from '@services/exchange/exchange.types';
import { map, omit, range } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import type { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({
      pairs: [
        { symbol: 'BTC/USDT', timeframe: '1m' },
        { symbol: 'ETH/USDT', timeframe: '1m' },
      ],
      daterange: { start: '2024-01-01' },
    }),
  },
}));
vi.mock('@services/logger', () => ({ error: vi.fn() }));

const SYMBOL: `${string}/${string}` = 'BTC/USDT';
const ETH_SYMBOL: `${string}/${string}` = 'ETH/USDT';

const defaultMarketData = {
  price: { min: 1, max: 10_000 },
  amount: { min: 0.1, max: 100 },
  cost: { min: 10, max: 100_000 },
  precision: { price: 2, amount: 2 },
  fee: { maker: 0.001, taker: 0.002 },
};

/** The same marketData entry for both watched pairs: the dummy refuses a watched pair without one */
const createMarketData = (marketData: MarketData) =>
  new Map<TradingPair, MarketData>([
    [SYMBOL, marketData],
    [ETH_SYMBOL, marketData],
  ]);

const baseConfig: DummyCentralizedExchangeConfig = {
  name: 'dummy-cex',
  exchangeSynchInterval: 200,
  orderSynchInterval: 200,
  marketData: createMarketData(defaultMarketData),
  simulationBalance: new Map([
    ['BTC', 10],
    ['USDT', 50_000],
  ]),
  initialTicker: new Map([[SYMBOL, { bid: 100, ask: 101 }]]),
};

const createSimulationBalance = (btc: number, usdt: number) =>
  new Map([
    ['BTC', btc],
    ['USDT', usdt],
  ]);

const createExchange = (overrides: Partial<DummyCentralizedExchangeConfig> = {}) =>
  new DummyCentralizedExchange({ ...baseConfig, ...overrides });

const sampleCandle = (start: number, overrides: Partial<Candle> = {}): Candle => ({
  id: undefined,
  start,
  open: 100,
  high: 110,
  low: 90,
  close: 100,
  volume: 10,
  ...overrides,
});

/** Helper to create a CandleBucket for processOneMinuteBucket calls */
const createBucket = (start: number, overrides: Partial<Candle> = {}) => new Map([[SYMBOL, sampleCandle(start, overrides)]]);

describe('DummyCentralizedExchange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Constructor and Basic Methods', () => {
    it('returns dummy-cex as exchange name', () => {
      expect(createExchange().getExchangeName()).toBe('dummy-cex');
    });

    it('loadMarkets resolves immediately', async () => {
      await expect(createExchange().loadMarkets()).resolves.toBeUndefined();
    });

    it('getMarketData returns configured market data', () => {
      expect(createExchange().getMarketData(SYMBOL).fee).toEqual({ maker: 0.001, taker: 0.002 });
    });

    // A watched pair without marketData would trade free of fees and order limits. The configuration schema refuses it, but
    // PaperTradingBinanceExchange builds its dummy directly. BTC/USDT and ETH/USDT are watched.
    it.each`
      symbols                  | missing
      ${[SYMBOL]}              | ${'ETH/USDT'}
      ${[]}                    | ${'BTC/USDT, ETH/USDT'}
      ${[SYMBOL, 'DOGE/USDT']} | ${'ETH/USDT'}
    `('refuses marketData for $symbols only, naming the watched pairs without one: $missing', ({ symbols, missing }) => {
      const marketData = new Map<TradingPair, MarketData>(symbols.map((symbol: TradingPair) => [symbol, defaultMarketData]));
      expect(() => createExchange({ marketData })).toThrow(
        `[EXCHANGE] Each watched pair needs a marketData entry, or dummy-cex fills its orders with no fees and no order limits (missing: ${missing})`,
      );
    });

    it('accepts marketData for each watched pair, and for a pair that is not watched', () => {
      const marketData = createMarketData(defaultMarketData).set('DOGE/USDT', defaultMarketData);
      expect(() => createExchange({ marketData })).not.toThrow();
    });
  });

  describe('fetchTicker', () => {
    it('returns initial ticker when no candles processed', async () => {
      expect(await createExchange().fetchTicker(SYMBOL)).toEqual({ bid: 100, ask: 101 });
    });

    it('returns last candle close as ticker after processing', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000, { close: 150 }));
      expect(await exchange.fetchTicker(SYMBOL)).toEqual({ bid: 150, ask: 150 });
    });
  });

  describe('fetchBalance', () => {
    it('returns initial balance', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(5, 1000) });
      const balance = await exchange.fetchBalance();
      expect(balance.get('BTC')).toEqual({ free: 5, used: 0, total: 5 });
      expect(balance.get('USDT')).toEqual({ free: 1000, used: 0, total: 1000 });
    });
  });

  describe('fetchOHLCV', () => {
    it('returns empty array when no candles', async () => {
      expect(await createExchange().fetchOHLCV(SYMBOL, {})).toEqual([]);
    });

    it('returns all candles when no from specified', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      await exchange.processOneMinuteBucket(createBucket(2000));
      expect(await exchange.fetchOHLCV(SYMBOL, {})).toHaveLength(2);
    });

    it('returns candles from specified timestamp', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      await exchange.processOneMinuteBucket(createBucket(2000));
      expect(await exchange.fetchOHLCV(SYMBOL, { from: 2000 })).toHaveLength(1);
    });

    it('returns empty when from is beyond all candles', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      expect(await exchange.fetchOHLCV(SYMBOL, { from: 9999 })).toHaveLength(0);
    });

    // The buffer holds two candles, starting at 1000 and 2000: the first candle returned is the first one starting at or after from
    it.each`
      from    | position              | expected
      ${999}  | ${'before the first'} | ${[1000, 2000]}
      ${1000} | ${'at the first'}     | ${[1000, 2000]}
      ${1500} | ${'between the two'}  | ${[2000]}
      ${2000} | ${'at the second'}    | ${[2000]}
      ${2001} | ${'after the second'} | ${[]}
    `('returns the candles starting at $expected from $from, $position', async ({ from, expected }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      await exchange.processOneMinuteBucket(createBucket(2000));
      expect(map(await exchange.fetchOHLCV(SYMBOL, { from }), 'start')).toEqual(expected);
    });
  });

  describe('createLimitOrder', () => {
    it.each`
      side      | reserveField
      ${'BUY'}  | ${'USDT'}
      ${'SELL'} | ${'BTC'}
    `('$side order reserves $reserveField balance', async ({ side, reserveField }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, side, 1, 100);
      const balance = await exchange.fetchBalance();
      expect(balance.get(reserveField as string)?.used).toBeGreaterThan(0);
    });

    it('throws when insufficient currency for BUY', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10) });
      await expect(exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for SELL', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10000) });
      await expect(exchange.createLimitOrder(SYMBOL, 'SELL', 1, 100)).rejects.toThrow('Insufficient asset');
    });
  });

  describe('createMarketOrder', () => {
    it.each`
      side      | balanceChange
      ${'BUY'}  | ${'increases asset'}
      ${'SELL'} | ${'decreases asset'}
    `('$side order $balanceChange immediately', async ({ side }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const before = await exchange.fetchBalance();
      await exchange.createMarketOrder(SYMBOL, side, 1);
      const after = await exchange.fetchBalance();
      expect(after.get('BTC')?.total).not.toBe(before.get('BTC')?.total);
    });

    it('throws when insufficient currency for market BUY', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10) });
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await expect(exchange.createMarketOrder(SYMBOL, 'BUY', 1)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for market SELL', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10000) });
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await expect(exchange.createMarketOrder(SYMBOL, 'SELL', 1)).rejects.toThrow('Insufficient asset');
    });
  });

  // The limits are checked by assertOrderWithinLimits, as CCXTExchange checks them: an order out of them is refused with the same
  // OrderOutOfRangeError, and the same message, in backtest and paper trading as live. The dummy used to throw an InvalidOrder with
  // messages of its own, some of them broken ("Invalid cost: cost", "Must be between 0.1 and undefined"), and did not check the price
  // of a market order. defaultMarketData allows prices from 1 to 10 000, amounts from 0.1 to 100 and costs from 10 to 100 000.
  describe('Order limits', () => {
    /** A limit order at `price`, or a market order on an exchange whose ticker is at `price`, its bid and its ask */
    const placeOrder = (
      type: 'limit' | 'market',
      side: OrderSide,
      amount: number,
      price: number,
      marketData: MarketData = defaultMarketData,
    ) => {
      const exchange = createExchange({
        marketData: createMarketData(marketData),
        initialTicker: new Map([[SYMBOL, { bid: price, ask: price }]]),
      });
      return type === 'limit' ? exchange.createLimitOrder(SYMBOL, side, amount, price) : exchange.createMarketOrder(SYMBOL, side, amount);
    };

    it.each`
      type        | side      | amount  | price     | violation
      ${'limit'}  | ${'BUY'}  | ${1}    | ${0.5}    | ${'its price below the minimum'}
      ${'limit'}  | ${'SELL'} | ${1}    | ${20_000} | ${'its price above the maximum'}
      ${'limit'}  | ${'BUY'}  | ${0.01} | ${100}    | ${'its amount below the minimum'}
      ${'limit'}  | ${'SELL'} | ${200}  | ${100}    | ${'its amount above the maximum'}
      ${'limit'}  | ${'BUY'}  | ${0.1}  | ${50}     | ${'its cost below the minimum'}
      ${'limit'}  | ${'SELL'} | ${50}   | ${5_000}  | ${'its cost above the maximum'}
      ${'market'} | ${'BUY'}  | ${1}    | ${20_000} | ${'its price above the maximum'}
      ${'market'} | ${'SELL'} | ${1}    | ${0.5}    | ${'its price below the minimum'}
      ${'market'} | ${'BUY'}  | ${0.01} | ${100}    | ${'its amount below the minimum'}
      ${'market'} | ${'SELL'} | ${0.1}  | ${50}     | ${'its cost below the minimum'}
    `(
      'rejects a $type $side order of $amount at $price, $violation, with an OrderOutOfRangeError',
      async ({ type, side, amount, price }) => {
        await expect(placeOrder(type, side, amount, price)).rejects.toThrow(OrderOutOfRangeError);
      },
    );

    // ETH/USDT has no initial ticker, and no candle has given it one
    it('rejects a market order on a pair without a ticker yet with an InvalidOrder', async () => {
      await expect(createExchange().createMarketOrder(ETH_SYMBOL, 'BUY', 1)).rejects.toThrow(InvalidOrder);
    });

    // The message is the one of the shared formatter, as live. The dummy used to say "Invalid cost: cost" for the first order, and
    // "Invalid amount: Must be between 0.1 and undefined" for the second, on a market without a maximum amount.
    it.each`
      type        | side      | amount  | price  | marketData                                        | property    | value   | detail
      ${'market'} | ${'SELL'} | ${0.1}  | ${50}  | ${defaultMarketData}                              | ${'cost'}   | ${5}    | ${'is out of range. Expected a value between 10 and 100000.'}
      ${'limit'}  | ${'BUY'}  | ${0.01} | ${100} | ${{ ...defaultMarketData, amount: { min: 0.1 } }} | ${'amount'} | ${0.01} | ${'is too low. Minimum allowed is 0.1.'}
    `(
      'rejects a $type $side order of $amount at $price with the message of the shared formatter: $property $detail',
      async ({ type, side, amount, price, marketData, property, value, detail }) => {
        await expect(placeOrder(type, side, amount, price, marketData)).rejects.toThrow(
          `[EXCHANGE] Order '${property}' with value ${value} ${detail}`,
        );
      },
    );

    // As CCXTExchange, a market order is checked at the price it executes at: the ask for a BUY, the bid for a SELL
    it.each`
      side      | price
      ${'BUY'}  | ${20_000}
      ${'SELL'} | ${0.5}
    `('checks a market $side order at $price, given a bid of 0.5 and an ask of 20 000', async ({ side, price }) => {
      const exchange = createExchange({ initialTicker: new Map([[SYMBOL, { bid: 0.5, ask: 20_000 }]]) });
      await expect(exchange.createMarketOrder(SYMBOL, side, 1)).rejects.toThrow(
        `[EXCHANGE] Order 'price' with value ${price} is out of range. Expected a value between 1 and 10000.`,
      );
    });
  });

  describe('cancelOrder', () => {
    it('cancels open order and releases balance', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100);
      const canceled = await exchange.cancelOrder(SYMBOL, order.id);
      expect(canceled.status).toBe('canceled');
    });

    it('throws when order not found', async () => {
      await expect(createExchange().cancelOrder(SYMBOL, 'unknown-id')).rejects.toThrow('Unknown order');
    });

    it('does not change already closed order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createMarketOrder(SYMBOL, 'BUY', 1);
      const canceled = await exchange.cancelOrder(SYMBOL, order.id);
      expect(canceled.status).toBe('closed');
    });
  });

  // A limit BUY reserves its cost, maker fee included, and a limit SELL its amount. Its cancelation releases and its execution
  // spends the same value, computed once for the three, so that a settled order leaves exactly nothing in used, whatever rounding
  // its amount and price bring.
  describe('Limit order reservation', () => {
    const AMOUNT = 0.37;
    const cancel = (exchange: DummyCentralizedExchange, id: string) => exchange.cancelOrder(SYMBOL, id);
    // The default candle (low 90, high 110) reaches both prices below
    const fill = (exchange: DummyCentralizedExchange) => exchange.processOneMinuteBucket(createBucket(Date.now()));

    it.each`
      side      | price     | reserved  | expected
      ${'BUY'}  | ${95.37}  | ${'USDT'} | ${AMOUNT * 95.37 * (1 + 0.001)}
      ${'SELL'} | ${104.63} | ${'BTC'}  | ${AMOUNT}
    `('reserves $expected $reserved for a $side order of 0.37 at $price', async ({ side, price, reserved, expected }) => {
      const exchange = createExchange();
      await exchange.createLimitOrder(SYMBOL, side, AMOUNT, price);
      const balance = await exchange.fetchBalance();
      expect(balance.get(reserved)?.used).toBe(expected);
    });

    it.each`
      side      | price     | reserved  | settlement    | settle
      ${'BUY'}  | ${95.37}  | ${'USDT'} | ${'canceled'} | ${cancel}
      ${'BUY'}  | ${95.37}  | ${'USDT'} | ${'filled'}   | ${fill}
      ${'SELL'} | ${104.63} | ${'BTC'}  | ${'canceled'} | ${cancel}
      ${'SELL'} | ${104.63} | ${'BTC'}  | ${'filled'}   | ${fill}
    `('leaves exactly 0 $reserved used once a $side order of 0.37 at $price is $settlement', async ({ side, price, reserved, settle }) => {
      const exchange = createExchange();
      const { id } = await exchange.createLimitOrder(SYMBOL, side, AMOUNT, price);
      await settle(exchange, id);
      const balance = await exchange.fetchBalance();
      expect(balance.get(reserved)?.used).toBe(0);
    });
  });

  // The fees and order limits of a pair come from its marketData entry, which each watched pair has. An order on a pair without one
  // used to be checked against no limits, then accepted if the portfolio held its asset and its currency: on USDT/BTC, BTC/USDT the
  // other way round, it traded free of fees, and no candle would ever fill a limit order. A USDT is worth 0.00001 BTC here.
  describe.each`
    type        | side      | symbol         | price
    ${'limit'}  | ${'BUY'}  | ${'USDT/BTC'}  | ${0.00001}
    ${'limit'}  | ${'SELL'} | ${'USDT/BTC'}  | ${0.00001}
    ${'limit'}  | ${'BUY'}  | ${'DOGE/USDT'} | ${0.1}
    ${'limit'}  | ${'SELL'} | ${'DOGE/USDT'} | ${0.1}
    ${'market'} | ${'BUY'}  | ${'USDT/BTC'}  | ${0.00001}
    ${'market'} | ${'SELL'} | ${'USDT/BTC'}  | ${0.00001}
    ${'market'} | ${'BUY'}  | ${'DOGE/USDT'} | ${0.1}
    ${'market'} | ${'SELL'} | ${'DOGE/USDT'} | ${0.1}
  `('$type $side order on $symbol at $price, a pair without marketData', ({ type, side, symbol, price }) => {
    /** A candle of the pair closing at the price gives it a ticker, so that a market order gets past the ticker check */
    const createExchangeWithTicker = async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(new Map([[symbol, sampleCandle(Date.now() - 60_000, { close: price })]]));
      return exchange;
    };

    const placeOrder = (exchange: DummyCentralizedExchange) =>
      type === 'limit' ? exchange.createLimitOrder(symbol, side, 1, price) : exchange.createMarketOrder(symbol, side, 1);

    it('is rejected with an InvalidOrder', async () => {
      const exchange = await createExchangeWithTicker();
      await expect(placeOrder(exchange)).rejects.toThrow(InvalidOrder);
    });

    it('leaves the portfolio unchanged', async () => {
      const exchange = await createExchangeWithTicker();
      const before = await exchange.fetchBalance();
      await placeOrder(exchange).catch(() => undefined);
      expect(await exchange.fetchBalance()).toEqual(before);
    });
  });

  // Before its ticker is read: USDT/BTC has none
  it('names the pair and the pairs it has marketData for when it rejects an order on a pair without marketData', async () => {
    await expect(createExchange().createMarketOrder('USDT/BTC', 'SELL', 1)).rejects.toThrow(
      'Unknown symbol USDT/BTC: dummy-cex only trades the pairs it has a marketData entry for (BTC/USDT, ETH/USDT)',
    );
  });

  // The portfolio holds a balance for each asset and currency of the watched pairs, BTC, USDT and ETH, and for nothing else. An
  // order on another pair used to read the balance it lacks as undefined: a TypeError, thrown by a market order after it had changed
  // the other balance, or a limit order accepted, its balance reserved, that no candle would ever fill.
  describe.each`
    type        | side      | symbol
    ${'limit'}  | ${'BUY'}  | ${'DOGE/USDT'}
    ${'limit'}  | ${'SELL'} | ${'DOGE/USDT'}
    ${'limit'}  | ${'BUY'}  | ${'BTC/EUR'}
    ${'limit'}  | ${'SELL'} | ${'BTC/EUR'}
    ${'market'} | ${'BUY'}  | ${'DOGE/USDT'}
    ${'market'} | ${'SELL'} | ${'DOGE/USDT'}
    ${'market'} | ${'BUY'}  | ${'BTC/EUR'}
    ${'market'} | ${'SELL'} | ${'BTC/EUR'}
  `('$type $side order on $symbol, a pair that is not watched', ({ type, side, symbol }) => {
    /**
     * A marketData entry for the pair, which the constructor accepts although the pair is not watched, gets the order past the
     * marketData check, and a candle of the pair, which gives it a ticker, gets a market order past the ticker check
     */
    const createExchangeWithTicker = async () => {
      const exchange = createExchange({ marketData: createMarketData(defaultMarketData).set(symbol, defaultMarketData) });
      await exchange.processOneMinuteBucket(new Map([[symbol, sampleCandle(Date.now() - 60_000)]]));
      return exchange;
    };

    const placeOrder = (exchange: DummyCentralizedExchange) =>
      type === 'limit' ? exchange.createLimitOrder(symbol, side, 1, 100) : exchange.createMarketOrder(symbol, side, 1);

    it('is rejected with an InvalidOrder', async () => {
      const exchange = await createExchangeWithTicker();
      await expect(placeOrder(exchange)).rejects.toBeInstanceOf(InvalidOrder);
    });

    it('leaves the portfolio unchanged', async () => {
      const exchange = await createExchangeWithTicker();
      const before = await exchange.fetchBalance();
      await placeOrder(exchange).catch(() => undefined);
      expect(await exchange.fetchBalance()).toEqual(before);
    });
  });

  it('names the pair and the assets of the portfolio when it rejects an order on a pair that is not watched', async () => {
    const exchange = createExchange({ marketData: createMarketData(defaultMarketData).set('DOGE/USDT', defaultMarketData) });
    await expect(exchange.createLimitOrder('DOGE/USDT', 'BUY', 1, 100)).rejects.toThrow(
      'Unknown symbol DOGE/USDT: the portfolio only holds the assets and currencies of the watched pairs (BTC, USDT, ETH)',
    );
  });

  describe('fetchOrder', () => {
    it('returns order by id', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100);
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ id: order.id, status: 'open' });
    });

    it('throws when order not found', async () => {
      await expect(createExchange().fetchOrder(SYMBOL, 'invalid-id')).rejects.toThrow('Unknown order');
    });
  });

  // fetchMyTrades used to return one trade per order ever created, open and canceled ones included (with an amount of 0), and to
  // scan every order of the session to find them, on each call (one per completed order, from createOrderSummary)
  describe('fetchMyTrades', () => {
    /** An exchange whose clock is at now: it has processed the candle of the last minute (low 90, high 110, close 100) */
    const createStartedExchange = async (overrides: Partial<DummyCentralizedExchangeConfig> = {}) => {
      const exchange = createExchange(overrides);
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      return exchange;
    };

    /** A market BUY executes at once, at now */
    const executeMarketOrder = async (exchange: DummyCentralizedExchange) => (await exchange.createMarketOrder(SYMBOL, 'BUY', 1)).id;

    /** A limit BUY at 95 executes with the next candle (low 90), whose close is a minute from now */
    const executeLimitOrder = async (exchange: DummyCentralizedExchange) => {
      const { id } = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 95);
      await exchange.processOneMinuteBucket(createBucket(Date.now()));
      return id;
    };

    /** Market BUYs executed at now, now + 1 minute, now + 2 minutes... in this order */
    const executeMarketOrdersMinutesApart = async (count: number) => {
      const exchange = await createStartedExchange();
      const ids: string[] = [];
      for (let minute = 0; minute < count; minute++) {
        if (minute) await exchange.processOneMinuteBucket(createBucket(Date.now() + (minute - 1) * 60_000));
        ids.push(await executeMarketOrder(exchange));
      }
      return { exchange, ids };
    };

    it('returns empty when no orders', async () => {
      expect(await createExchange().fetchMyTrades(SYMBOL)).toEqual([]);
    });

    it.each`
      type        | execute               | price  | when                     | delay     | rate
      ${'market'} | ${executeMarketOrder} | ${100} | ${'at once'}             | ${0}      | ${0.2}
      ${'limit'}  | ${executeLimitOrder}  | ${95}  | ${'with a later candle'} | ${60_000} | ${0.1}
    `(
      'reports a $type order as one execution of its whole amount at $price, $when, with a fee rate of $rate %',
      async ({ execute, price, delay, rate }) => {
        const exchange = await createStartedExchange();
        const id = await execute(exchange);
        expect(await exchange.fetchMyTrades(SYMBOL)).toEqual([{ id, amount: 1, price, timestamp: Date.now() + delay, fee: { rate } }]);
      },
    );

    it.each`
      type        | execute
      ${'market'} | ${executeMarketOrder}
      ${'limit'}  | ${executeLimitOrder}
    `('reports a $type order execution with a fee rate of 0 when the market data has no fee', async ({ execute }) => {
      const exchange = await createStartedExchange({ marketData: createMarketData(omit(defaultMarketData, 'fee')) });
      await execute(exchange);
      const [trade] = await exchange.fetchMyTrades(SYMBOL);
      expect(trade.fee.rate).toBe(0);
    });

    it('returns no trade for a limit order still open', async () => {
      const exchange = await createStartedExchange();
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 50);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 80 }));
      expect(await exchange.fetchMyTrades(SYMBOL)).toEqual([]);
    });

    it('returns no trade for a canceled limit order', async () => {
      const exchange = await createStartedExchange();
      const { id } = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 50);
      await exchange.cancelOrder(SYMBOL, id);
      expect(await exchange.fetchMyTrades(SYMBOL)).toEqual([]);
    });

    // A sticky order moves by canceling its limit order and creating another one: createOrderSummary looks for the trades of both
    it('returns the execution of the limit order that replaced a canceled one, and nothing for the canceled one', async () => {
      const exchange = await createStartedExchange();
      const canceled = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 50);
      await exchange.cancelOrder(SYMBOL, canceled.id);
      const id = await executeLimitOrder(exchange);
      expect(map(await exchange.fetchMyTrades(SYMBOL), 'id')).toEqual([id]);
    });

    it('returns every execution, oldest first, without from', async () => {
      const { exchange, ids } = await executeMarketOrdersMinutesApart(2);
      expect(map(await exchange.fetchMyTrades(SYMBOL), 'id')).toEqual(ids);
    });

    // The first execution is at now, the second a minute later
    it.each`
      from                       | offset    | expected
      ${'just before the first'} | ${-1}     | ${['first', 'second']}
      ${'the first'}             | ${0}      | ${['first', 'second']}
      ${'just after the first'}  | ${1}      | ${['second']}
      ${'the second'}            | ${60_000} | ${['second']}
      ${'just after the second'} | ${60_001} | ${[]}
    `('returns the executions $expected of two a minute apart from the time of $from', async ({ offset, expected }) => {
      const {
        exchange,
        ids: [first, second],
      } = await executeMarketOrdersMinutesApart(2);
      const trades = await exchange.fetchMyTrades(SYMBOL, Date.now() + offset);
      expect(map(trades, 'id')).toEqual(expected.map((name: 'first' | 'second') => ({ first, second })[name]));
    });

    // The clock does not go back during a run (see currentTimestamp), but should it, the journal is still kept in timestamp order
    describe('after an execution at a time earlier than the previous one', () => {
      const executeBackInTime = async () => {
        const exchange = createExchange();
        await exchange.processOneMinuteBucket(createBucket(Date.now() + 9 * 60_000));
        const later = await executeMarketOrder(exchange); // at now + 10 minutes
        await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
        const earlier = await executeMarketOrder(exchange); // at now
        return { exchange, later, earlier };
      };

      it('returns both executions in timestamp order', async () => {
        const { exchange, later, earlier } = await executeBackInTime();
        expect(map(await exchange.fetchMyTrades(SYMBOL), 'id')).toEqual([earlier, later]);
      });

      it('returns the later execution alone from a time between the two', async () => {
        const { exchange, later } = await executeBackInTime();
        expect(map(await exchange.fetchMyTrades(SYMBOL, Date.now() + 1), 'id')).toEqual([later]);
      });
    });

    it('returns copies: changing a trade returned does not change the next ones', async () => {
      const exchange = await createStartedExchange();
      await executeMarketOrder(exchange);
      const [trade] = await exchange.fetchMyTrades(SYMBOL);
      trade.fee.rate = 42;
      const [again] = await exchange.fetchMyTrades(SYMBOL);
      expect(again.fee.rate).toBe(0.2);
    });

    // Like ccxt given a limit: the oldest trades from `from`, the most recent ones without it
    describe('when LIMITS caps the trades returned at 2', () => {
      const { trades: defaultLimit } = LIMITS['dummy-cex'];

      beforeEach(() => {
        LIMITS['dummy-cex'].trades = 2;
      });

      afterEach(() => {
        LIMITS['dummy-cex'].trades = defaultLimit;
      });

      it('returns the 2 most recent executions without from', async () => {
        const { exchange, ids } = await executeMarketOrdersMinutesApart(3);
        expect(map(await exchange.fetchMyTrades(SYMBOL), 'id')).toEqual(ids.slice(1));
      });

      it('returns the first 2 executions at or after from', async () => {
        const { exchange, ids } = await executeMarketOrdersMinutesApart(3);
        expect(map(await exchange.fetchMyTrades(SYMBOL, Date.now()), 'id')).toEqual(ids.slice(0, 2));
      });
    });
  });

  describe('Order Settlement', () => {
    it('fills BUY order when candle low reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 95);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 95 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('fills SELL order when candle high reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 105);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { high: 105 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('does not fill BUY order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 50);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 80 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'open' });
    });

    it('does not fill SELL order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 150);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { high: 120 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'open' });
    });
  });

  // In backtest, LimitOrder and StickyOrder learn about fills through onSettled and also handle the state cancelOrder returns, so a
  // cancel reported through onSettled as well reached them twice (orderCanceled and orderStatusChanged emitted twice per cancel).
  describe.each`
    side      | price
    ${'BUY'}  | ${95}
    ${'SELL'} | ${105}
  `('$side limit order created with an onSettled callback', ({ side, price }) => {
    // The default candle (low 90, high 110) reaches both prices
    const createOrderWithCallback = async () => {
      const exchange = createExchange();
      const onSettled = vi.fn();
      const { id } = await exchange.createLimitOrder(SYMBOL, side, 1, price, onSettled);
      return { exchange, onSettled, id };
    };

    it('calls it once with the closed state when a candle fills the order', async () => {
      const { exchange, onSettled, id } = await createOrderWithCallback();
      await exchange.processOneMinuteBucket(createBucket(Date.now()));
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id, status: 'closed', filled: 1, remaining: 0 }));
    });

    it('does not call it when the order is canceled', async () => {
      const { exchange, onSettled, id } = await createOrderWithCallback();
      await exchange.cancelOrder(SYMBOL, id);
      expect(onSettled).not.toHaveBeenCalled();
    });

    it('returns the canceled state from cancelOrder', async () => {
      const { exchange, id } = await createOrderWithCallback();
      expect(await exchange.cancelOrder(SYMBOL, id)).toMatchObject({ id, status: 'canceled', filled: 0, remaining: 1 });
    });

    it('does not call it when a later candle reaches the price of the canceled order', async () => {
      const { exchange, onSettled, id } = await createOrderWithCallback();
      await exchange.cancelOrder(SYMBOL, id);
      await exchange.processOneMinuteBucket(createBucket(Date.now()));
      expect(onSettled).not.toHaveBeenCalled();
    });
  });

  describe('Multi-pair isolation', () => {
    // BTC/USDT trades around 100 and ETH/USDT around 20, with different maker fees. Each bucket below starts with the other
    // pair's candle, which crosses the order price (an ETH low of 15 crosses a BTC BUY at 80, a BTC high of 110 an ETH SELL
    // at 30), so a pair-blind matcher fills the order before its own candle is even read.
    const btc = (overrides: Partial<Candle> = {}) => [SYMBOL, sampleCandle(1000, overrides)] as const;
    const eth = (overrides: Partial<Candle> = {}) =>
      [ETH_SYMBOL, sampleCandle(1000, { open: 20, high: 25, low: 15, close: 20, ...overrides })] as const;

    const createMultiPairExchange = () =>
      createExchange({
        marketData: new Map([
          [SYMBOL, defaultMarketData],
          [ETH_SYMBOL, { ...defaultMarketData, fee: { maker: 0.003, taker: 0.004 } }],
        ]),
        simulationBalance: new Map([
          ['BTC', 10],
          ['ETH', 10],
          ['USDT', 50_000],
        ]),
      });

    const settleLimitOrder = async (symbol: TradingPair, side: OrderSide, price: number, bucket: CandleBucket) => {
      const exchange = createMultiPairExchange();
      const { id } = await exchange.createLimitOrder(symbol, side, 1, price);
      await exchange.processOneMinuteBucket(bucket);
      return { order: await exchange.fetchOrder(symbol, id), balance: await exchange.fetchBalance() };
    };

    it.each`
      side      | symbol        | price | bucket
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 90 })])}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 25 })])}
    `('$side $symbol limit order stays open when only the other pair candle reaches its price', async ({ side, symbol, price, bucket }) => {
      const { order } = await settleLimitOrder(symbol, side, price, bucket);
      expect(order.status).toBe('open');
    });

    it.each`
      side      | symbol        | price | bucket                                 | asset    | total
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'BTC'} | ${11}
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'ETH'} | ${10}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'ETH'} | ${9}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'BTC'} | ${10}
    `('$side $symbol limit order filled by its own candle leaves $total $asset', async ({ side, symbol, price, bucket, asset, total }) => {
      const { balance } = await settleLimitOrder(symbol, side, price, bucket);
      expect(balance.get(asset)?.total).toBe(total);
    });

    it.each`
      side      | symbol        | price | bucket                                 | usdt
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${50_000 - 80 * (1 + 0.001)}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${50_000 + 30 * (1 - 0.003)}
    `('$side $symbol limit order filled by its own candle pays its own pair maker fee', async ({ side, symbol, price, bucket, usdt }) => {
      const { balance } = await settleLimitOrder(symbol, side, price, bucket);
      expect(balance.get('USDT')?.total).toBeCloseTo(usdt, 8);
    });

    it.each`
      side      | symbol        | price | bucket                                 | reserved
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'USDT'}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'ETH'}
    `(
      '$side $symbol limit order filled by its own candle releases its $reserved reservation',
      async ({ side, symbol, price, bucket, reserved }) => {
        const { balance } = await settleLimitOrder(symbol, side, price, bucket);
        expect(balance.get(reserved)?.used).toBe(0);
      },
    );

    it('cancelOrder releases the reservation on the pair of the order, whatever symbol it is given', async () => {
      const exchange = createMultiPairExchange();
      const { id } = await exchange.createLimitOrder(ETH_SYMBOL, 'SELL', 1, 30);
      await exchange.cancelOrder(SYMBOL, id);
      const balance = await exchange.fetchBalance();
      expect(balance.get('ETH')?.used).toBe(0);
    });

    // Both orders execute at the close of the bucket, 61 000
    it.each`
      symbol        | from
      ${SYMBOL}     | ${undefined}
      ${ETH_SYMBOL} | ${undefined}
      ${SYMBOL}     | ${61_000}
      ${ETH_SYMBOL} | ${61_000}
    `('fetchMyTrades for $symbol from $from only returns the execution of its own order', async ({ symbol, from }) => {
      const exchange = createMultiPairExchange();
      await exchange.processOneMinuteBucket(new Map([btc(), eth()]));
      const ids = new Map<TradingPair, string>();
      for (const pair of [SYMBOL, ETH_SYMBOL]) ids.set(pair, (await exchange.createMarketOrder(pair, 'BUY', 1)).id);
      expect(map(await exchange.fetchMyTrades(symbol, from), 'id')).toEqual([ids.get(symbol)]);
    });
  });

  describe('processOneMinuteBucket', () => {
    it('updates ticker with candle close', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000, { close: 200 }));
      expect(await exchange.fetchTicker(SYMBOL)).toEqual({ bid: 200, ask: 200 });
    });

    it('adds candle to OHLCV history', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      expect(await exchange.fetchOHLCV(SYMBOL, {})).toHaveLength(1);
    });
  });

  // Every candle processed used to stay in the buffer, which nothing reads: some 400 MB for a BTC/USDT backtest since 2017
  describe('Candle buffer', () => {
    const FULL = DUMMY_CANDLE_BUFFER_SIZE + DUMMY_CANDLE_BUFFER_TRIM_MARGIN; // the most candles a pair holds before the next trim

    // Bucket i holds a BTC/USDT and an ETH/USDT candle, both starting at minute i
    const processBuckets = async (count: number) => {
      const exchange = createExchange();
      for (let i = 0; i < count; i++)
        await exchange.processOneMinuteBucket(
          new Map([
            [SYMBOL, sampleCandle(i * 60_000)],
            [ETH_SYMBOL, sampleCandle(i * 60_000)],
          ]),
        );
      return exchange;
    };

    it.each`
      symbol        | buckets     | kept
      ${SYMBOL}     | ${FULL}     | ${FULL}
      ${SYMBOL}     | ${FULL + 1} | ${DUMMY_CANDLE_BUFFER_SIZE}
      ${ETH_SYMBOL} | ${FULL + 1} | ${DUMMY_CANDLE_BUFFER_SIZE}
    `('keeps $kept $symbol candles after $buckets buckets', async ({ symbol, buckets, kept }) => {
      const exchange = await processBuckets(buckets);
      // From minute 0 and without a limit, fetchOHLCV returns the whole buffer
      expect(await exchange.fetchOHLCV(symbol, { from: 0, limit: Number.MAX_SAFE_INTEGER })).toHaveLength(kept);
    });

    it.each`
      buckets
      ${FULL}
      ${FULL + 1}
    `('fetchOHLCV without from returns the last DUMMY_CANDLE_BUFFER_SIZE candles after $buckets buckets', async ({ buckets }) => {
      const exchange = await processBuckets(buckets);
      const starts = (await exchange.fetchOHLCV(SYMBOL)).map(({ start }) => start);
      expect(starts).toEqual(range(buckets - DUMMY_CANDLE_BUFFER_SIZE, buckets).map(minute => minute * 60_000));
    });

    it('fetchOHLCV from a minute already dropped starts at the oldest candle kept', async () => {
      const exchange = await processBuckets(FULL + 1);
      const [oldest] = await exchange.fetchOHLCV(SYMBOL, { from: 0, limit: 1 });
      expect(oldest.start).toBe((FULL + 1 - DUMMY_CANDLE_BUFFER_SIZE) * 60_000);
    });
  });

  // A candle fills a book from its head up to the first order it does not reach, which only works if BUY orders are kept by
  // descending price and SELL orders by ascending price. Each candle below reaches only part of the book, so a book kept in the wrong
  // order, or a settlement that fills nothing or everything, fills other orders than the ones expected. Created in the order given,
  // the 3-order books insert into an empty book, at its head and in its middle; the 2-order books insert at their tail.
  describe('Order Insertion and Sorting', () => {
    const settleBook = async (side: OrderSide, prices: number[], candle: Partial<Candle>) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const ids = new Map<number, string>();
      for (const price of prices) ids.set(price, (await exchange.createLimitOrder(SYMBOL, side, 1, price)).id);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), candle));
      return { exchange, ids };
    };

    it.each`
      side      | prices             | candle           | price  | status
      ${'BUY'}  | ${[80, 90, 85]}    | ${{ low: 87 }}   | ${90}  | ${'closed'}
      ${'BUY'}  | ${[80, 90, 85]}    | ${{ low: 87 }}   | ${85}  | ${'open'}
      ${'BUY'}  | ${[80, 90, 85]}    | ${{ low: 87 }}   | ${80}  | ${'open'}
      ${'BUY'}  | ${[90, 80]}        | ${{ low: 85 }}   | ${90}  | ${'closed'}
      ${'BUY'}  | ${[90, 80]}        | ${{ low: 85 }}   | ${80}  | ${'open'}
      ${'SELL'} | ${[120, 110, 115]} | ${{ high: 113 }} | ${110} | ${'closed'}
      ${'SELL'} | ${[120, 110, 115]} | ${{ high: 113 }} | ${115} | ${'open'}
      ${'SELL'} | ${[120, 110, 115]} | ${{ high: 113 }} | ${120} | ${'open'}
      ${'SELL'} | ${[110, 120]}      | ${{ high: 115 }} | ${110} | ${'closed'}
      ${'SELL'} | ${[110, 120]}      | ${{ high: 115 }} | ${120} | ${'open'}
    `(
      '$side book $prices leaves its order at $price $status after a candle reaching $candle',
      async ({ side, prices, candle, price, status }) => {
        const { exchange, ids } = await settleBook(side, prices, candle);
        const order = await exchange.fetchOrder(SYMBOL, ids.get(price)!);
        expect(order.status).toBe(status);
      },
    );

    it.each`
      side      | prices             | candle           | price
      ${'BUY'}  | ${[80, 90, 85]}    | ${{ low: 87 }}   | ${90}
      ${'BUY'}  | ${[90, 80]}        | ${{ low: 85 }}   | ${90}
      ${'SELL'} | ${[120, 110, 115]} | ${{ high: 113 }} | ${110}
      ${'SELL'} | ${[110, 120]}      | ${{ high: 115 }} | ${110}
    `(
      '$side book $prices reports the execution of its order at $price alone after a candle reaching $candle',
      async ({ side, prices, candle, price }) => {
        const { exchange, ids } = await settleBook(side, prices, candle);
        expect(await exchange.fetchMyTrades(SYMBOL)).toEqual([expect.objectContaining({ id: ids.get(price), amount: 1 })]);
      },
    );

    // A new order goes before the orders already at its price, so the candle, which reaches that price exactly, fills the second
    // order created before the first one (executions are journaled in the order they fill). It does not reach the third order.
    it.each`
      side      | prices             | candle
      ${'BUY'}  | ${[95, 95, 90]}    | ${{ low: 95 }}
      ${'SELL'} | ${[105, 105, 110]} | ${{ high: 105 }}
    `(
      '$side book $prices fills its two orders at the same price, the most recent first, after a candle reaching $candle',
      async ({ side, prices, candle }) => {
        const exchange = createExchange();
        await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
        const ids: string[] = [];
        for (const price of prices) ids.push((await exchange.createLimitOrder(SYMBOL, side, 1, price)).id);
        await exchange.processOneMinuteBucket(createBucket(Date.now(), candle));
        expect(map(await exchange.fetchMyTrades(SYMBOL), 'id')).toEqual([ids[1], ids[0]]);
      },
    );
  });
});
