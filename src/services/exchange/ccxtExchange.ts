import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { Heart } from '@services/core/heart/heart';
import { debug, error } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { Exchange as CCXT, MarketInterface } from 'ccxt';
import { formatDuration, intervalToDuration, startOfMinute, subMinutes } from 'date-fns';
import { first, isNil, last } from 'lodash-es';
import { z } from 'zod';
import { binanceExchangeSchema } from './binance/binance.schema';
import { LIMITS, PARAMS } from './exchange.const';
import { Exchange, FetchOHLCVParams, MarketData, OrderSettledCallback } from './exchange.types';
import {
  checkMandatoryFeatures,
  checkOrderAmount,
  checkOrderCost,
  checkOrderPrice,
  createExchange,
  mapCcxtOrderToOrder,
  mapCcxtTradeToTrade,
  mapOhlcvToCandles,
  retry,
} from './exchange.utils';
import { hyperliquidExchangeSchema } from './hyperliquid/hyperliquid.schema';

type BinanceExchangeConfig = z.infer<typeof binanceExchangeSchema>;
type HyperliquidExchangeConfig = z.infer<typeof hyperliquidExchangeSchema>;
export type CCXTExchangeConfig = BinanceExchangeConfig | HyperliquidExchangeConfig;

export class CCXTExchange implements Exchange {
  protected heart: Heart;
  protected publicClient: CCXT;
  protected privateClient: CCXT;
  protected exchangeName: string;
  protected symbol: string;

  constructor(exchangeConfig: CCXTExchangeConfig) {
    const { pairs } = config.getWatch();
    const { symbol } = pairs[0]; // TODO: Regression - currently only supports the first pair. Need to refactor CCXTExchange to be multi-pair aware or instantiate per pair.
    const { name, sandbox } = exchangeConfig;

    const { publicClient, privateClient } = createExchange(exchangeConfig);
    this.publicClient = publicClient;
    this.privateClient = privateClient;

    checkMandatoryFeatures(this.publicClient, sandbox);

    this.exchangeName = name;
    this.symbol = symbol;
    this.heart = new Heart(ONE_MINUTE);
  }

  getMarketData(): MarketData {
    const market = this.publicClient.market(this.symbol);
    return {
      amount: {
        min: market.limits?.amount?.min,
        max: market.limits?.amount?.max,
      },
      price: {
        min: market.limits?.price?.min,
        max: market.limits?.price?.max,
      },
      cost: {
        min: market.limits?.cost?.min,
        max: market.limits?.cost?.max,
      },
      precision: {
        price: market.precision?.price,
        amount: market.precision?.amount,
      },
      fee: {
        maker: market.maker,
        taker: market.taker,
      },
    };
  }

  getExchangeName(): string {
    return this.exchangeName;
  }

  public onNewCandle(onNewCandle: (candle: Candle) => void) {
    if (!this.heart.isHeartBeating()) {
      this.heart.on('tick', async () => {
        try {
          // Calculate the start of the previous minute to ensure we fetch the last completed candle
          const from = startOfMinute(subMinutes(Date.now(), 1)).getTime();
          const candles = await this.fetchOHLCV({ from, limit: 1 });
          if (candles.length > 0) onNewCandle(candles[0]);
        } catch (err) {
          error('exchange', `Failed to poll for new candle: ${err}`);
        }
      });
      // Delay the first tick to align with the next minute
      const delay = ONE_MINUTE - (Date.now() % ONE_MINUTE);
      setTimeout(() => this.heart.pump(), delay);
    }
    return () => this.heart.stop();
  }

  public async loadMarkets() {
    await Promise.all([this.publicClient.loadMarkets(), this.privateClient.loadMarkets()]);
  }

  public async fetchTicker() {
    return retry<Ticker>(async () => {
      const ticker = await this.publicClient.fetchTicker(this.symbol, PARAMS.fetchTicker[this.exchangeName]);
      if (isNil(ticker.last)) throw new GekkoError('exchange', 'Fetch ticker failed to return data');
      return { ask: ticker.ask ?? ticker.last, bid: ticker.bid ?? ticker.last };
    });
  }

  public async fetchOHLCV({ from, timeframe = '1m', limit = LIMITS[this.exchangeName].candles }: FetchOHLCVParams) {
    return retry<Candle[]>(async () => {
      const ohlcvList = await this.publicClient.fetchOHLCV(this.symbol, timeframe, from, limit);
      const candles = mapOhlcvToCandles(ohlcvList);

      debug(
        'exchange',
        [
          `Fetched candles from ${this.exchangeName}.`,
          `From ${toISOString(first(candles)?.start)}`,
          `to ${toISOString(last(candles)?.start)}`,
          `(${formatDuration(intervalToDuration({ start: first(candles)?.start ?? 0, end: last(candles)?.start ?? 0 }))})`,
        ].join(' '),
      );

      return candles;
    });
  }

  public async fetchMyTrades(from?: EpochTimeStamp) {
    return retry<Trade[]>(async () => {
      const trades = await this.privateClient.fetchMyTrades(this.symbol, from, LIMITS[this.exchangeName].trades);
      return trades.map(mapCcxtTradeToTrade);
    });
  }

  public async fetchOrder(id: string) {
    return retry<OrderState>(async () => {
      const order = await this.privateClient.fetchOrder(id, this.symbol);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async fetchBalance() {
    return retry<Portfolio>(async () => {
      const balance = await this.privateClient.fetchBalance(PARAMS.fetchBalance[this.exchangeName]);
      const { baseName, quote, base } = this.publicClient.market(this.symbol) as MarketInterface & { baseName: string }; // Workaround: CCXT sometimes misses 'base' in market structure
      const asset = balance[baseName ?? base];
      const currency = balance[quote];

      return new Map([
        [
          baseName ?? base,
          {
            free: asset?.free ?? 0,
            used: asset?.used ?? 0,
            total: asset?.total ?? 0,
          },
        ],
        [
          quote,
          {
            free: currency?.free ?? 0,
            used: currency?.used ?? 0,
            total: currency?.total ?? 0,
          },
        ],
      ]);
    });
  }

  public async createLimitOrder(
    side: OrderSide,
    amount: number,
    price: number,
    _onSettled?: OrderSettledCallback, // Ignored - real exchanges use polling
  ) {
    return retry<OrderState>(async () => {
      const limits = this.publicClient.market(this.symbol).limits;
      const orderPrice = checkOrderPrice(price, limits);
      const orderAmount = checkOrderAmount(amount, limits);
      checkOrderCost(orderAmount, orderPrice, limits);

      const order = await this.privateClient.createOrder(this.symbol, 'limit', side, orderAmount, orderPrice);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async createMarketOrder(side: OrderSide, amount: number) {
    return retry<OrderState>(async () => {
      const limits = this.publicClient.market(this.symbol).limits;
      const orderAmount = checkOrderAmount(amount, limits);
      const ticker = await this.fetchTicker();
      const price = side === 'BUY' ? ticker.ask : ticker.bid;
      checkOrderCost(orderAmount, price, limits);

      const order = await this.privateClient.createOrder(this.symbol, 'market', side, orderAmount);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async cancelOrder(id: string) {
    return retry<OrderState>(async () => {
      const order = await this.privateClient.cancelOrder(id, this.symbol);
      return mapCcxtOrderToOrder(order);
    });
  }
}
