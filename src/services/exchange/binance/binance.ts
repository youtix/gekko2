import { GekkoError } from '@errors/gekko.error';
import { Action } from '@models/action.types';
import { Candle } from '@models/candle.types';
import { ExchangeConfig } from '@models/configuration.types';
import { debug, error, info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import {
  BinanceSpotOrder,
  mapAccountTradeToTrade,
  mapKlinesToCandles,
  mapPublicTradeToTrade,
  mapSpotOrderToOrder,
} from './binance.utils';
import type { AxiosError } from 'axios';
import {
  KlineInterval,
  MainClient,
  SymbolFilter,
  SymbolLotSizeFilter,
  SymbolMinNotionalFilter,
  SymbolPriceFilter,
  WebsocketClient,
  WsFormattedMessage,
} from 'binance';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, isNil, last } from 'lodash-es';
import { Exchange, MarketLimits } from '../exchange';
import { LIMITS } from '../exchange.const';
import { InvalidOrder, OrderNotFound } from '../exchange.error';

export class BinanceExchange extends Exchange {
  private ws: WebsocketClient;
  private client: MainClient;
  private marketLimits?: MarketLimits;

  constructor(exchangeConfig: ExchangeConfig) {
    super(exchangeConfig);
    this.client = new MainClient({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      beautifyResponses: true,
      testnet: this.sandbox,
    });
    this.ws = new WebsocketClient(
      { beautify: true, testnet: this.sandbox, api_key: this.apiKey, api_secret: this.apiSecret },
      {
        trace: (params: unknown) => debug('exchange', params),
        info: (params: unknown) => info('exchange', params),
        error: (params: unknown) => error('exchange', params),
      },
    );
  }

  public onNewCandle(onNewCandle: (candle: Candle) => void) {
    const symbol = `${this.asset}${this.currency}`.toLowerCase();

    const handler = (msg: WsFormattedMessage) => {
      if (!Array.isArray(msg) && msg.eventType === 'kline' && msg.symbol?.toLowerCase() === symbol && msg.kline.final) {
        onNewCandle({
          start: msg.kline.startTime,
          open: msg.kline.open,
          close: msg.kline.close,
          high: msg.kline.high,
          low: msg.kline.low,
          volume: msg.kline.volume,
          volumeActive: msg.kline.volumeActive,
          quoteVolume: msg.kline.quoteVolume,
          quoteVolumeActive: msg.kline.quoteVolumeActive,
        });
      }
    };
    this.ws.on('formattedMessage', handler);
    this.ws.subscribeKlines(symbol, '1m', 'spot');

    return () => {
      try {
        this.ws.unsubscribe([symbol], 'main');
      } finally {
        this.ws.off('formattedMessage', handler);
      }
    };
  }

  protected async loadMarketsImpl() {
    const symbol = this.getRestSymbol();
    try {
      const { symbols } = await this.client.getExchangeInfo({ symbol });
      const [market] = symbols ?? [];
      if (!market)
        throw new GekkoError('exchange', `Missing market information for ${symbol} on ${this.getExchangeName()}.`);
      this.marketLimits = this.extractMarketLimits(market.filters ?? []);
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async fetchTickerImpl() {
    const symbol = this.getRestSymbol();
    try {
      const ticker = await this.client.getSymbolOrderBookTicker({ symbol });
      const payload = Array.isArray(ticker) ? ticker[0] : ticker;
      const ask = this.parseNumber(payload?.askPrice);
      const bid = this.parseNumber(payload?.bidPrice);
      if (isNil(ask) || isNil(bid))
        throw new GekkoError('exchange', 'Missing ask & bid property in payload after calling fetchTicker function.');
      return { ask, bid };
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async getKlinesImpl(
    startTime?: EpochTimeStamp,
    interval: KlineInterval = '1m',
    limit = LIMITS[this.exchangeName],
  ) {
    const symbol = this.getRestSymbol();
    try {
      const ohlcvList = await this.client.getKlines({ symbol, interval, startTime, limit });
      const candles = mapKlinesToCandles(ohlcvList);

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
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async fetchTradesImpl() {
    const symbol = this.getRestSymbol();
    const limit = LIMITS[this.exchangeName];
    try {
      const trades = await this.client.getRecentTrades({
        symbol,
        ...(limit ? { limit } : {}),
      });
      return trades.map(mapPublicTradeToTrade);
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async fetchMyTradesImpl(from?: EpochTimeStamp) {
    const symbol = this.getRestSymbol();
    const limit = LIMITS[this.exchangeName];
    try {
      const trades = await this.client.getAccountTradeList({
        symbol,
        startTime: from,
        ...(limit ? { limit } : {}),
      });
      return trades.map(mapAccountTradeToTrade);
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async fetchPortfolioImpl() {
    try {
      const account = await this.client.getAccountInformation();
      const balances = account.balances ?? [];
      const assetBalance = balances.find(balance => balance.asset === this.asset);
      const currencyBalance = balances.find(balance => balance.asset === this.currency);
      return {
        asset: this.parseNumber(assetBalance?.free) ?? 0,
        currency: this.parseNumber(currencyBalance?.free) ?? 0,
      };
    } catch (error) {
      throw this.toError(error);
    }
  }

  protected async fetchOrderImpl(id: string) {
    const symbol = this.getRestSymbol();
    try {
      const order = await this.client.getOrder({ symbol, ...this.buildOrderIdentifier(id) });
      return mapSpotOrderToOrder(order as BinanceSpotOrder);
    } catch (error) {
      throw this.transformOrderError(error);
    }
  }

  protected async createLimitOrderImpl(side: Action, amount: number) {
    const orderPrice = await this.calculatePrice(side);
    const orderAmount = this.calculateAmount(amount);
    this.checkCost(orderAmount, orderPrice);

    const symbol = this.getRestSymbol();
    try {
      const order = await this.client.submitNewOrder({
        symbol,
        side: side.toUpperCase() as 'BUY' | 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: orderAmount,
        price: orderPrice,
      });
      return mapSpotOrderToOrder(order as BinanceSpotOrder);
    } catch (error) {
      throw this.transformOrderError(error);
    }
  }

  protected async cancelLimitOrderImpl(id: string) {
    const symbol = this.getRestSymbol();
    try {
      const order = await this.client.cancelOrder({ symbol, ...this.buildOrderIdentifier(id) });
      return mapSpotOrderToOrder(order as BinanceSpotOrder);
    } catch (error) {
      throw this.transformOrderError(error);
    }
  }

  protected getMarketLimits() {
    return this.marketLimits;
  }

  protected isRetryableError(error: unknown): boolean {
    if (!this.isAxiosError(error)) return false;

    const status = error.response?.status;
    return !status || status >= 500;
  }

  private getRestSymbol() {
    return `${this.asset}${this.currency}`;
  }

  private extractMarketLimits(filters: SymbolFilter[]): MarketLimits {
    const priceFilter = filters.find((filter): filter is SymbolPriceFilter => filter.filterType === 'PRICE_FILTER');
    const amountFilter = filters.find((filter): filter is SymbolLotSizeFilter => filter.filterType === 'LOT_SIZE');
    const notionalFilter = filters.find(
      (filter): filter is SymbolMinNotionalFilter => filter.filterType === 'NOTIONAL',
    );

    return {
      price: priceFilter
        ? { min: this.parseMin(priceFilter.minPrice), max: this.parseMax(priceFilter.maxPrice) }
        : undefined,
      amount: amountFilter
        ? { min: this.parseMin(amountFilter.minQty), max: this.parseMax(amountFilter.maxQty) }
        : undefined,
      cost: notionalFilter
        ? { min: this.parseMin(notionalFilter.minNotional), max: this.parseMax(notionalFilter.maxNotional) }
        : undefined,
    };
  }

  private buildOrderIdentifier(id: string) {
    const orderId = Number(id);
    if (Number.isFinite(orderId)) {
      return { orderId };
    }

    return { origClientOrderId: id };
  }

  private transformOrderError(error: unknown): never {
    if (this.isBinanceError(error)) {
      if (error.code !== undefined) {
        if ([-2013, -2011].includes(error.code)) throw new OrderNotFound(error.message ?? 'Order not found');
        if ([-2010, -1013, -1011, -1100, -1102].includes(error.code))
          throw new InvalidOrder(error.message ?? 'Invalid order');
      }
    }

    throw this.toError(error);
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (this.isBinanceError(error)) return new GekkoError('exchange', error.message ?? `Binance error ${error.code}`);
    return new GekkoError('exchange', String(error));
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return typeof error === 'object' && error !== null && (error as AxiosError).isAxiosError === true;
  }

  private isBinanceError(error: unknown): error is { code?: number; message?: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'number'
    );
  }

  private parseNumber(value?: string | number) {
    if (isNil(value)) return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseMin(value?: string | number) {
    return this.parseNumber(value);
  }

  private parseMax(value?: string | number) {
    const parsed = this.parseNumber(value);
    if (parsed === undefined || parsed === 0) return undefined;
    return parsed;
  }
}
