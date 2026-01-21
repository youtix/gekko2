import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { Symbol } from '@models/utility.types';
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
import { Exchange, FetchOHLCVParams, MarketData, OrderSettledCallback, Ticker } from './exchange.types';
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

  constructor(exchangeConfig: CCXTExchangeConfig) {
    const { name, sandbox } = exchangeConfig;

    const { publicClient, privateClient } = createExchange(exchangeConfig);
    this.publicClient = publicClient;
    this.privateClient = privateClient;

    checkMandatoryFeatures(this.publicClient, sandbox);

    this.exchangeName = name;
    this.heart = new Heart(ONE_MINUTE);
  }

  getMarketData(symbol: Symbol): MarketData {
    const market = this.publicClient.market(symbol);
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

  public onNewCandle(symbol: string, onNewCandle: (candle: Candle) => void) {
    if (!this.heart.isHeartBeating()) {
      this.heart.on('tick', async () => {
        try {
          // Calculate the start of the previous minute to ensure we fetch the last completed candle
          const from = startOfMinute(subMinutes(Date.now(), 1)).getTime();
          const candles = await this.fetchOHLCV(symbol, { from, limit: 1 });
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

  public async fetchTicker(symbol: string) {
    return retry<Ticker>(async () => {
      const ticker = await this.publicClient.fetchTicker(symbol, PARAMS.fetchTicker[this.exchangeName]);
      if (isNil(ticker.last)) throw new GekkoError('exchange', 'Fetch ticker failed to return data');
      return { ask: ticker.ask ?? ticker.last, bid: ticker.bid ?? ticker.last };
    });
  }

  public async fetchOHLCV(symbol: string, params: FetchOHLCVParams = {}) {
    return retry<Candle[]>(async () => {
      const { from, timeframe = '1m', limit = LIMITS[this.exchangeName].candles } = params;
      const ohlcvList = await this.publicClient.fetchOHLCV(symbol, timeframe, from, limit);
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

  public async fetchMyTrades(symbol: string, from?: EpochTimeStamp) {
    return retry<Trade[]>(async () => {
      const trades = await this.privateClient.fetchMyTrades(symbol, from, LIMITS[this.exchangeName].trades);
      return trades.map(mapCcxtTradeToTrade);
    });
  }

  public async fetchOrder(symbol: string, id: string) {
    return retry<OrderState>(async () => {
      const order = await this.privateClient.fetchOrder(id, symbol);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async fetchBalance() {
    return retry<Portfolio>(async () => {
      const balance = await this.privateClient.fetchBalance(PARAMS.fetchBalance[this.exchangeName]);
      const { pairs } = config.getWatch();
      const portfolio = new Map();
      for (const { symbol } of pairs) {
        const { baseName, quote, base } = this.publicClient.market(symbol) as MarketInterface & { baseName: string }; // Workaround: CCXT sometimes misses 'base' in market structure
        const asset = balance[baseName ?? base];
        const currency = balance[quote];
        portfolio.set(baseName ?? base, { free: asset?.free ?? 0, used: asset?.used ?? 0, total: asset?.total ?? 0 });
        portfolio.set(quote, { free: currency?.free ?? 0, used: currency?.used ?? 0, total: currency?.total ?? 0 });
      }
      return portfolio;
    });
  }

  public async createLimitOrder(
    symbol: string,
    side: OrderSide,
    amount: number,
    price: number,
    _onSettled?: OrderSettledCallback, // Ignored - real exchanges use polling
  ) {
    return retry<OrderState>(async () => {
      const limits = this.publicClient.market(symbol).limits;
      const orderPrice = checkOrderPrice(price, limits);
      const orderAmount = checkOrderAmount(amount, limits);
      checkOrderCost(orderAmount, orderPrice, limits);

      const order = await this.privateClient.createOrder(symbol, 'limit', side, orderAmount, orderPrice);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async createMarketOrder(symbol: string, side: OrderSide, amount: number) {
    return retry<OrderState>(async () => {
      const limits = this.publicClient.market(symbol).limits;
      const orderAmount = checkOrderAmount(amount, limits);
      const ticker = await this.fetchTicker(symbol);
      const price = side === 'BUY' ? ticker.ask : ticker.bid;
      checkOrderCost(orderAmount, price, limits);

      const order = await this.privateClient.createOrder(symbol, 'market', side, orderAmount);
      return mapCcxtOrderToOrder(order);
    });
  }

  public async cancelOrder(symbol: string, id: string) {
    return retry<OrderState>(async () => {
      const order = await this.privateClient.cancelOrder(id, symbol);
      return mapCcxtOrderToOrder(order);
    });
  }
}
