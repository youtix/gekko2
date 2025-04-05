import { MissingPropertyError } from '@errors/broker/missingProperty.error';
import { candlesSchema } from '@models/schema/candle.schema';
import { Action } from '@models/types/action.types';
import { BrokerConfig } from '@models/types/configuration.types';
import { isOrderStatus, Order } from '@models/types/order.types';
import { logger } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { mapToCandles, mapToOrder, mapToTrades } from '@utils/trade/trade.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, isNil, last } from 'lodash-es';
import { Broker } from '../broker';
import { LIMITS } from './generic.const';

export class GenericBroker extends Broker {
  constructor(brokerConfig: BrokerConfig) {
    super(brokerConfig);
  }

  protected async fetchTickerOnce() {
    const ticker = await this.broker.fetchTicker(this.symbol);
    if (isNil(ticker.ask) || isNil(ticker.bid)) throw new MissingPropertyError('ask & bid', 'fetchTicker');
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

    logger.debug(
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
    if (!isOrderStatus(order.status)) throw new MissingPropertyError('status', 'createLimitOrder');
    return mapToOrder(order);
  }

  protected async createLimitOrderOnce(side: Action, amount: number) {
    const orderPrice = await this.calculatePrice(side);
    const orderAmount = await this.calculateAmount(amount);
    this.checkCost(orderAmount, orderPrice);
    const order = await this.broker.createLimitOrder(this.symbol, side, orderAmount, orderPrice);
    if (!isOrderStatus(order.status)) throw new MissingPropertyError('status', 'createLimitOrder');
    return mapToOrder(order);
  }

  protected async cancelLimitOrderOnce(id: string) {
    const order = (await this.broker.cancelOrder(id, this.symbol)) as Order;
    return { ...order };
  }
}
