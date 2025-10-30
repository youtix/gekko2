import {
  ORDER_ABORTED_EVENT,
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderAborted, OrderCanceled, OrderCompleted, OrderErrored, OrderInitiated } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { Order } from '@services/core/order/order';
import { ORDER_PARTIALLY_FILLED_EVENT, ORDER_STATUS_CHANGED_EVENT } from '@services/core/order/order.const';
import { debug, error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { wait } from '@utils/process/process.utils';
import { bindAll, filter, isEqual } from 'lodash-es';
import { UUID } from 'node:crypto';
import { ORDER_FACTORY, SYNCHRONIZATION_INTERVAL } from './trader.const';
import { traderSchema } from './trader.schema';
import { findWhyWeCannotBuy, findWhyWeCannotSell, processCostAndPrice, resolveOrderAmount } from './trader.utils';

export class Trader extends Plugin {
  private readonly orders: Order[];
  private sendInitialPortfolio: boolean;
  private warmupCompleted: boolean;
  private warmupCandle?: Candle;
  private portfolio: Portfolio;
  private balance: number;
  private price: number;
  // Timer controlling periodic synchronization with the exchange.
  private syncInterval?: Timer;

  constructor() {
    super(Trader.name);
    this.orders = [];
    this.sendInitialPortfolio = false;
    this.warmupCompleted = false;
    this.warmupCandle = undefined;
    this.portfolio = { asset: 0, currency: 0 };
    this.balance = 0;
    this.price = 0;

    bindAll(this, ['synchronize']);

    const { mode } = config.getWatch();
    if (mode === 'realtime') {
      this.syncInterval = setInterval(this.synchronize, SYNCHRONIZATION_INTERVAL);
    }
  }

  private async synchronize() {
    const exchange = this.getExchange();
    info('trader', `Synchronizing data with ${exchange.getExchangeName()}`);
    if (!this.price) {
      const sleepInterval = exchange.getInterval();
      const ticker = await exchange.fetchTicker();
      this.price = ticker.bid;
      await wait(sleepInterval);
    }
    const oldPortfolio = this.portfolio;
    this.portfolio = await exchange.fetchPortfolio();
    debug(
      'trader',
      `Current portfolio: ${this.portfolio.asset} ${this.asset} / ${this.portfolio.currency} ${this.currency}`,
    );

    this.setBalance();
    if (this.sendInitialPortfolio && !isEqual(oldPortfolio, this.portfolio)) this.emitPortfolioChangeEvent();
  }

  private emitPortfolioChangeEvent() {
    this.deferredEmit(PORTFOLIO_CHANGE_EVENT, {
      asset: this.portfolio.asset,
      currency: this.portfolio.currency,
    });
  }

  private emitPortfolioValueChangeEvent() {
    this.deferredEmit(PORTFOLIO_VALUE_CHANGE_EVENT, {
      balance: this.balance,
    });
  }

  private setBalance() {
    if (!this.portfolio.asset && !this.portfolio.currency) return;
    this.balance = this.price * this.portfolio.asset + this.portfolio.currency;
  }

  public onStrategyWarmupCompleted() {
    this.warmupCompleted = true;
    const candle = this.warmupCandle;
    this.warmupCandle = undefined;
    if (!candle) throw new GekkoError('trader', 'No warmup candle on strategy warmup completed event');
    void this.processOneMinuteCandle(candle);
  }

  public onStrategyCancelOrder(id: UUID) {
    const orderInstance = this.getOrder(id);
    if (!orderInstance) return warning('trader', 'Impossible to cancel order: Unknown Order');

    const orderType = orderInstance.getType();
    orderInstance.removeAllListeners();
    orderInstance.once(ORDER_COMPLETED_EVENT, async () => {
      this.removeOrder(id);
      this.deferredEmit<OrderCanceled>(ORDER_CANCELED_EVENT, {
        orderId: id,
        date: Date.now(),
        orderType,
      });
      // We do not check if cancel goes bad because we cannot do much for it
      await this.synchronize();
    });
    orderInstance.cancel();
  }

  public onStrategyCreateOrder(advice: Advice) {
    const { order, date, id } = advice;
    const { side, type, quantity } = order;
    const price = this.price;
    const requestedAmount = resolveOrderAmount(this.portfolio, price, side, quantity);

    if (side === 'BUY') {
      const currency = this.portfolio.currency;
      const insufficient = requestedAmount <= 0 || price <= 0 || currency < requestedAmount * price;
      if (insufficient) {
        const reason = findWhyWeCannotBuy(requestedAmount, price, currency, this.currency);
        warning(
          'trader',
          `NOT buying ${requestedAmount} ${this.asset} @ ${price} ${this.currency}/${this.asset} [${type} order]: ${reason}`,
        );
        return this.deferredEmit<OrderAborted>(ORDER_ABORTED_EVENT, {
          orderId: id,
          side: side,
          portfolio: this.portfolio,
          balance: this.balance,
          date,
          reason,
          orderType: type,
          requestedAmount,
        });
      }
      info('trader', `Received BUY ${type} order advice. Buying ${requestedAmount} ${this.asset}`);
    }

    if (side === 'SELL') {
      const asset = this.portfolio.asset;
      const insufficient = requestedAmount <= 0 || price <= 0 || asset < requestedAmount;
      if (insufficient) {
        const reason = findWhyWeCannotSell(requestedAmount, price, asset, this.asset);
        warning(
          'trader',
          `NOT selling ${requestedAmount} ${this.asset} @ ${price} ${this.currency}/${this.asset} [${type} order]: ${reason}`,
        );
        return this.deferredEmit<OrderAborted>(ORDER_ABORTED_EVENT, {
          orderId: id,
          side: side,
          portfolio: this.portfolio,
          balance: this.balance,
          date,
          reason,
          orderType: type,
          requestedAmount,
        });
      }
      info('trader', `Received SELL ${type} order advice. Selling ${requestedAmount} ${this.asset}`);
    }

    this.createOrder(advice, requestedAmount);
  }

  private async createOrder(advice: Advice, amount: number) {
    const { order, date, id } = advice;
    const { side, type } = order;
    info('trader', `Creating ${type} order to ${side} ${amount} ${this.asset}`);
    this.deferredEmit<OrderInitiated>(ORDER_INITIATED_EVENT, {
      orderId: id,
      side: side,
      portfolio: this.portfolio,
      balance: this.balance,
      date,
      orderType: type,
      requestedAmount: amount,
    });
    const exchange = this.getExchange();

    const orderInstance = new ORDER_FACTORY[type](id, side, amount, exchange);
    this.orders.push(orderInstance);

    orderInstance.on(ORDER_PARTIALLY_FILLED_EVENT, filled =>
      info('trader', `Partial ${side} fill, total filled: ${filled}`),
    );
    orderInstance.on(ORDER_STATUS_CHANGED_EVENT, status => debug('trader', `status changed: ${status}`));
    orderInstance.on(ORDER_ERRORED_EVENT, reason => {
      error('trader', `Gekko received error: ${reason}`);
      this.removeOrder(id);
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        orderType: type,
        date: Date.now(),
        reason,
      });
      this.synchronize();
    });
    orderInstance.on(ORDER_COMPLETED_EVENT, async () => {
      try {
        await this.handleOrderCompletedEvent(advice, amount);
      } catch (err) {
        if (err instanceof Error) {
          error('trader', err.message);
          return this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
            orderId: id,
            orderType: type,
            date: Date.now(),
            reason: err.message,
          });
        }
      }
    });
  }

  private async handleOrderCompletedEvent({ id, order }: Advice, requestedAmount: number) {
    const orderInstance = this.getOrder(id);
    if (!orderInstance) throw new GekkoError('trader', 'Missing order when handling order completed event');

    const summary = await orderInstance.createSummary();

    this.removeOrder(id);
    await this.synchronize();

    const { amount, price, feePercent, side, date } = summary;
    const { effectivePrice, cost } = processCostAndPrice(side, price, amount, feePercent);

    info(
      'trader',
      [
        `${side} ${order.type} order summary '${id}':`,
        `Completed at: ${toISOString(date)}`,
        `Order amount: ${amount},`,
        `Effective price: ${effectivePrice},`,
        `Cost: ${cost},`,
        `Fee percent: ${feePercent},`,
      ].join(' '),
    );

    this.deferredEmit<OrderCompleted>(ORDER_COMPLETED_EVENT, {
      orderId: id,
      side,
      cost,
      amount,
      price,
      portfolio: this.portfolio,
      balance: this.balance,
      date: date ?? 0,
      feePercent: feePercent,
      effectivePrice,
      orderType: order.type,
      requestedAmount,
    });
  }

  private removeOrder(id: UUID) {
    const index = this.orders.findIndex(o => o.getGekkoOrderId() === id);
    if (index >= 0) this.orders.splice(index, 1);
  }

  private getOrder(id: UUID) {
    const orderIndex = this.orders.findIndex(o => o.getGekkoOrderId() === id);
    if (orderIndex === -1) return;
    return this.orders[orderIndex];
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected async processOneMinuteCandle(candle: Candle) {
    if (!this.warmupCompleted) {
      this.warmupCandle = candle;
      return;
    }

    this.price = candle.close;
    const previousBalance = this.balance;
    this.setBalance();

    if (!this.sendInitialPortfolio) {
      this.sendInitialPortfolio = true;
      await this.synchronize();
      this.emitPortfolioChangeEvent();
    }

    if (this.balance !== previousBalance) {
      // this can happen because:
      // A) the price moved and we have > 0 asset
      // B) portfolio got changed
      this.emitPortfolioValueChangeEvent();
    }
  }

  protected processFinalize(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  public static getStaticConfiguration() {
    return {
      schema: traderSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: ['exchange'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Trader.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        PORTFOLIO_CHANGE_EVENT,
        PORTFOLIO_VALUE_CHANGE_EVENT,
        ORDER_ABORTED_EVENT,
        ORDER_CANCELED_EVENT,
        ORDER_COMPLETED_EVENT,
        ORDER_ERRORED_EVENT,
        ORDER_INITIATED_EVENT,
      ],
      name: 'Trader',
    };
  }
}
