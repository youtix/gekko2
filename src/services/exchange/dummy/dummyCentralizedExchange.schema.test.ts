import { configurationSchema } from '@services/configuration/configuration.schema';
import { cloneDeep, get, omit, set } from 'lodash-es';
import { describe, expect, it } from 'vitest';
import { dummyExchangeSchema } from './dummyCentralizedExchange.schema';

const MARKET_DATA = {
  price: { min: 0.01, max: 1_000_000 },
  amount: { min: 0.00001, max: 9000 },
  cost: { min: 5, max: 9_000_000 },
  precision: { price: 0.01, amount: 0.00001 },
  fee: { maker: 0.0004, taker: 0.0007 },
};

const createConfig = () => ({
  name: 'dummy-cex',
  simulationBalance: [{ assetName: 'USDT', balance: 1000 }],
  marketData: [{ symbol: 'BTC/USDT', marketData: cloneDeep(MARKET_DATA) }],
  initialTicker: [{ symbol: 'BTC/USDT', ticker: { bid: 99, ask: 100 } }],
});

/** The configuration with `value` set at `path` in the marketData entry of BTC/USDT */
const withMarketData = (path: string[], value: unknown) => set(createConfig(), ['marketData', 0, 'marketData', ...path], value);
const withTicker = (ticker: Record<string, unknown>) => set(createConfig(), ['initialTicker', 0, 'ticker'], ticker);

const feeMessage = (field: string) => `${field} must be a fraction between 0 and 1 (0.001 is a 0.1 % fee)`;

describe('dummyExchangeSchema', () => {
  it('maps each marketData entry to its symbol', () => {
    expect(dummyExchangeSchema.parse(createConfig()).marketData).toEqual(new Map([['BTC/USDT', MARKET_DATA]]));
  });

  it('maps each initial ticker to its symbol', () => {
    expect(dummyExchangeSchema.parse(createConfig()).initialTicker).toEqual(new Map([['BTC/USDT', { bid: 99, ask: 100 }]]));
  });

  it.each`
    field
    ${'marketData'}
    ${'initialTicker'}
  `('defaults $field to an empty map', ({ field }) => {
    const result = dummyExchangeSchema.parse(omit(createConfig(), field));
    expect(result[field as 'marketData' | 'initialTicker']).toEqual(new Map());
  });

  it('keeps the sync interval bounds shared by every exchange', () => {
    const result = dummyExchangeSchema.safeParse({ ...createConfig(), orderSynchInterval: 0 });
    expect(result.error?.issues).toMatchObject([{ path: ['orderSynchInterval'] }]);
  });

  describe('marketData', () => {
    // A negative max is reported once: the min ≤ max refinement, which zod still runs after the failed bound, skips it.
    it.each`
      path                       | value     | message
      ${['price', 'min']}        | ${-1}     | ${'price.min must be a number of at least 0'}
      ${['price', 'max']}        | ${-1}     | ${'price.max must be a number of at least 0'}
      ${['amount', 'min']}       | ${-1}     | ${'amount.min must be a number of at least 0'}
      ${['amount', 'max']}       | ${-1}     | ${'amount.max must be a number of at least 0'}
      ${['cost', 'min']}         | ${-1}     | ${'cost.min must be a number of at least 0'}
      ${['cost', 'max']}         | ${-1}     | ${'cost.max must be a number of at least 0'}
      ${['cost', 'min']}         | ${'5'}    | ${'cost.min must be a number of at least 0'}
      ${['price', 'min']}        | ${NaN}    | ${'price.min must be a number of at least 0'}
      ${['precision', 'price']}  | ${-2}     | ${'precision.price must be a number of at least 0'}
      ${['precision', 'amount']} | ${-2}     | ${'precision.amount must be a number of at least 0'}
      ${['fee', 'maker']}        | ${1.5}    | ${feeMessage('fee.maker')}
      ${['fee', 'maker']}        | ${-0.1}   | ${feeMessage('fee.maker')}
      ${['fee', 'taker']}        | ${1.5}    | ${feeMessage('fee.taker')}
      ${['fee', 'taker']}        | ${-0.1}   | ${feeMessage('fee.taker')}
      ${['fee', 'taker']}        | ${'0.1%'} | ${feeMessage('fee.taker')}
    `('reports $value at $path as its only issue', ({ path, value, message }) => {
      const result = dummyExchangeSchema.safeParse(withMarketData(path, value));
      expect(result.error?.issues).toMatchObject([{ path: ['marketData', 0, 'marketData', ...path], message }]);
    });

    it.each`
      range
      ${'price'}
      ${'amount'}
      ${'cost'}
    `('rejects a $range min above its max', ({ range }) => {
      const result = dummyExchangeSchema.safeParse(withMarketData([range], { min: 10, max: 5 }));
      expect(result.error?.issues).toMatchObject([
        {
          path: ['marketData', 0, 'marketData', range],
          message: `${range}.min must not exceed ${range}.max (leave max out for no maximum)`,
        },
      ]);
    });

    describe.each`
      range
      ${'price'}
      ${'amount'}
      ${'cost'}
    `('$range', ({ range }) => {
      it.each`
        scenario                             | limits
        ${'a max of 0, which sets no limit'} | ${{ min: 10, max: 0 }}
        ${'a max left out'}                  | ${{ min: 10 }}
        ${'a min equal to its max'}          | ${{ min: 5, max: 5 }}
        ${'a min of 0'}                      | ${{ min: 0, max: 5 }}
      `('accepts $scenario', ({ limits }) => {
        const result = dummyExchangeSchema.parse(withMarketData([range], limits));
        expect(get(result.marketData.get('BTC/USDT'), range)).toEqual(limits);
      });
    });

    it.each`
      path                       | value
      ${['precision', 'price']}  | ${0}
      ${['precision', 'amount']} | ${0}
      ${['fee', 'maker']}        | ${0}
      ${['fee', 'maker']}        | ${1}
      ${['fee', 'taker']}        | ${0}
      ${['fee', 'taker']}        | ${1}
    `('accepts $value at $path, a bound of its range', ({ path, value }) => {
      const result = dummyExchangeSchema.parse(withMarketData(path, value));
      expect(get(result.marketData.get('BTC/USDT'), path)).toBe(value);
    });
  });

  describe('initialTicker', () => {
    // A bid above an ask of 0 or below is reported once: the bid ≤ ask refinement, which zod still runs after the failed
    // bound, skips it.
    it.each`
      scenario                    | ticker                     | issue
      ${'a bid above the ask'}    | ${{ bid: 101, ask: 100 }}  | ${{ path: ['initialTicker', 0, 'ticker'], message: 'ticker.bid must not exceed ticker.ask' }}
      ${'a bid of 0'}             | ${{ bid: 0, ask: 100 }}    | ${{ path: ['initialTicker', 0, 'ticker', 'bid'], message: 'ticker.bid must be a number greater than 0' }}
      ${'a negative bid'}         | ${{ bid: -1, ask: 100 }}   | ${{ path: ['initialTicker', 0, 'ticker', 'bid'], message: 'ticker.bid must be a number greater than 0' }}
      ${'an ask of 0'}            | ${{ bid: 99, ask: 0 }}     | ${{ path: ['initialTicker', 0, 'ticker', 'ask'], message: 'ticker.ask must be a number greater than 0' }}
      ${'a negative ask'}         | ${{ bid: 99, ask: -1 }}    | ${{ path: ['initialTicker', 0, 'ticker', 'ask'], message: 'ticker.ask must be a number greater than 0' }}
      ${'an ask given as a text'} | ${{ bid: 99, ask: '100' }} | ${{ path: ['initialTicker', 0, 'ticker', 'ask'], message: 'ticker.ask must be a number greater than 0' }}
    `('reports $scenario as the only issue', ({ ticker, issue }) => {
      const result = dummyExchangeSchema.safeParse(withTicker(ticker));
      expect(result.error?.issues).toMatchObject([issue]);
    });

    it('accepts a bid equal to the ask', () => {
      const result = dummyExchangeSchema.parse(withTicker({ bid: 100, ask: 100 }));
      expect(result.initialTicker.get('BTC/USDT')).toEqual({ bid: 100, ask: 100 });
    });
  });

  // Zod still runs the configuration's refinement after these issues, with the marketData and initialTicker Maps left
  // unbuilt: the refinement must neither throw nor add an issue of its own.
  describe('in a backtest configuration', () => {
    const createBacktestConfig = (exchange: object) => ({
      watch: {
        assets: ['BTC'],
        currency: 'USDT',
        timeframe: '1m',
        mode: 'backtest',
        daterange: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-02T00:00:00.000Z' },
      },
      exchange,
      plugins: [],
    });

    it('accepts a valid exchange', () => {
      const result = configurationSchema.safeParse(createBacktestConfig(createConfig()));
      expect(result.error?.issues).toBeUndefined();
    });

    it.each`
      scenario                 | exchange                                           | path
      ${'a negative max'}      | ${withMarketData(['price', 'max'], -1)}            | ${['exchange', 'marketData', 0, 'marketData', 'price', 'max']}
      ${'a min above its max'} | ${withMarketData(['cost'], { min: 10, max: 5 })}   | ${['exchange', 'marketData', 0, 'marketData', 'cost']}
      ${'a fee of 150 %'}      | ${withMarketData(['fee', 'taker'], 1.5)}           | ${['exchange', 'marketData', 0, 'marketData', 'fee', 'taker']}
      ${'a bid above the ask'} | ${withTicker({ bid: 101, ask: 100 })}              | ${['exchange', 'initialTicker', 0, 'ticker']}
      ${'an interval of 0'}    | ${{ ...createConfig(), exchangeSynchInterval: 0 }} | ${['exchange', 'exchangeSynchInterval']}
    `('reports $scenario as the only issue', ({ exchange, path }) => {
      const result = configurationSchema.safeParse(createBacktestConfig(exchange));
      expect(result.error?.issues).toMatchObject([{ path }]);
    });
  });
});
