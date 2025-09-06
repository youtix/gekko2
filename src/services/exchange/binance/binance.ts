import { GekkoError } from '@errors/gekko.error';
import { Action } from '@models/action.types';
import { Candle } from '@models/candle.types';
import { ExchangeConfig } from '@models/configuration.types';
import { isOrderStatus, Order } from '@models/order.types';
import { debug, error, info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { mapKlinesToCandles, mapToOrder, mapToTrades } from '@utils/trade/trade.utils';
import { KlineInterval, MainClient, WebsocketClient, WsFormattedMessage } from 'binance';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, isNil, last } from 'lodash-es';
import { Exchange } from '../exchange';
import { LIMITS } from '../exchange.const';

export class BinanceExchange extends Exchange {
  private ws: WebsocketClient;
  private client: MainClient;

  constructor(exchangeConfig: ExchangeConfig) {
    super(exchangeConfig);
    this.client = new MainClient({ beautifyResponses: true });
    this.ws = new WebsocketClient(
      { beautify: true },
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

  protected async fetchTickerOnce() {
    const ticker = await this.exchange.fetchTicker(this.symbol);
    if (isNil(ticker.ask) || isNil(ticker.bid))
      throw new GekkoError('exchange', 'Missing ask & bid property in payload after calling fetchTicker function.');
    return { ask: ticker.ask, bid: ticker.bid };
  }

  protected async getKlinesOnce(
    startTime?: EpochTimeStamp,
    interval: KlineInterval = '1m',
    limit = LIMITS[this.exchangeName],
  ) {
    const symbol = `${this.asset}${this.currency}`;
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
  }

  protected async fetchTradesOnce() {
    const trades = await this.exchange.fetchTrades(this.symbol, undefined, LIMITS[this.exchangeName]);
    return mapToTrades(trades);
  }

  protected async fetchMyTradesOnce(from?: EpochTimeStamp) {
    const trades = await this.exchange.fetchMyTrades(this.symbol, from, LIMITS[this.exchangeName]);
    return mapToTrades(trades);
  }

  protected async fetchPortfolioOnce() {
    const balance = await this.exchange.fetchBalance();
    return {
      asset: balance[this.asset]?.free ?? 0,
      currency: balance[this.currency]?.free ?? 0,
    };
  }

  protected async fetchOrderOnce(id: string) {
    const order = await this.exchange.fetchOrder(id, this.symbol);
    if (!isOrderStatus(order.status))
      throw new GekkoError('exchange', 'Missing status property in payload after calling fetchOrder function.');
    return mapToOrder(order);
  }

  protected async createLimitOrderOnce(side: Action, amount: number) {
    const orderPrice = await this.calculatePrice(side);
    const orderAmount = this.calculateAmount(amount);
    this.checkCost(orderAmount, orderPrice);
    const order = await this.exchange.createLimitOrder(this.symbol, side, orderAmount, orderPrice);
    if (!isOrderStatus(order.status))
      throw new GekkoError('exchange', 'Missing status property in payload after calling createLimitOrder function.');
    return mapToOrder(order);
  }

  protected async cancelLimitOrderOnce(id: string) {
    const order = (await this.exchange.cancelOrder(id, this.symbol)) as Order;
    return { ...order };
  }
}
