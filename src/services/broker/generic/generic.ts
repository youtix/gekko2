import { GekkoError } from '@errors/gekko.error';
import { candlesSchema } from '@models/schema/candle.schema';
import { Action } from '@models/types/action.types';
import { BrokerConfig } from '@models/types/configuration.types';
import { isOrderStatus, Order } from '@models/types/order.types';
import { Broker } from '@services/broker/broker';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { mapToCandles, mapToOrder, mapToTrades } from '@utils/trade/trade.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, isNil, last } from 'lodash-es';
import { LIMITS } from './generic.const';

export class GenericBroker extends Broker {
  constructor(brokerConfig: BrokerConfig) {
    super(brokerConfig);
  }

  protected async fetchTickerOnce() {
    const ticker = await this.broker.fetchTicker(this.symbol);
    if (isNil(ticker.ask) || isNil(ticker.bid))
      throw new GekkoError('broker', 'Missing ask & bid property in payload after calling fetchTicker function.');
    return { ask: ticker.ask, bid: ticker.bid };
  }

  protected async fetchOHLCVOnce(from?: EpochTimeStamp) {
    const ohlcvList = await this.broker.fetchOHLCV(
      this.symbol,
      this.broker.timeframes['1m'] as string,
      from,
      LIMITS[this.brokerName],
    );
    const candles = mapToCandles(ohlcvList);
    candlesSchema.validate(candles);

    debug(
      'broker',
      [
        `Fetched candles from ${this.brokerName}.`,
        `From ${toISOString(first(candles)?.start)}`,
        `to ${toISOString(last(candles)?.start)}`,
        `(${formatDuration(intervalToDuration({ start: first(candles)?.start ?? 0, end: last(candles)?.start ?? 0 }))})`,
      ].join(' '),
    );

    return candles;
  }

  protected async fetchTradesOnce() {
    const trades = await this.broker.fetchTrades(this.symbol, undefined, LIMITS[this.brokerName]);
    return mapToTrades(trades);
  }

  protected async fetchMyTradesOnce(from?: EpochTimeStamp) {
    const trades = await this.broker.fetchMyTrades(this.symbol, from, LIMITS[this.brokerName]);
    return mapToTrades(trades);
  }

  protected async fetchPortfolioOnce() {
    const balance = await this.broker.fetchBalance();
    return {
      asset: balance[this.asset]?.free ?? 0,
      currency: balance[this.currency]?.free ?? 0,
    };
  }

  protected async fetchOrderOnce(id: string) {
    const order = await this.broker.fetchOrder(id, this.symbol);
    if (!isOrderStatus(order.status))
      throw new GekkoError('broker', 'Missing status property in payload after calling fetchOrder function.');
    return mapToOrder(order);
  }

  protected async createLimitOrderOnce(side: Action, amount: number) {
    const orderPrice = await this.calculatePrice(side);
    const orderAmount = this.calculateAmount(amount);
    this.checkCost(orderAmount, orderPrice);
    const order = await this.broker.createLimitOrder(this.symbol, side, orderAmount, orderPrice);
    if (!isOrderStatus(order.status))
      throw new GekkoError('broker', 'Missing status property in payload after calling createLimitOrder function.');
    return mapToOrder(order);
  }

  protected async cancelLimitOrderOnce(id: string) {
    const order = (await this.broker.cancelOrder(id, this.symbol)) as Order;
    return { ...order };
  }
}
