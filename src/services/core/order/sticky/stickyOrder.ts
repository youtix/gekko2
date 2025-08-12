import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Action } from '@models/types/action.types';
import { Order } from '@models/types/order.types';
import { Exchange } from '@services/exchange/exchange';
import { debug, warning } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { weightedMean } from '@utils/math/math.utils';
import { InvalidOrder, OrderNotFound } from 'ccxt';
import { bindAll, filter, find, first, isNil, last, map, reject, sortBy, sumBy } from 'lodash-es';
import { BaseOrder } from '../base/baseOrder';

export class StickyOrder extends BaseOrder {
  private completing: boolean;
  private moving: boolean;
  private checking: boolean;
  private side: Action;
  private amount: number;
  private id?: string;
  private interval?: Timer;

  constructor(action: Action, amount: number, exchange: Exchange) {
    super(exchange);
    this.completing = false;
    this.moving = false;
    this.checking = false;
    this.side = action;
    this.amount = amount;

    // Creating initial order
    const filledAmount = sumBy(this.transactions, 'filled');
    this.createOrder(action, amount - filledAmount);

    bindAll(this, ['checkOrder']);

    this.interval = setInterval(this.checkOrder, this.exchange.getInterval());
  }

  public getSide() {
    return this.side;
  }

  public async cancel() {
    if (this.isOrderCompleted()) return;
    this.completing = true;
    if (this.checking || this.getStatus() === 'initializing') return;

    if (this.id) await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') {
      clearInterval(this.interval);
      this.completing = false;
    }
  }

  public async createSummary() {
    if (!this.isOrderCompleted()) throw new GekkoError('core', 'Order is not completed');

    const from = resetDateParts(first(this.transactions)?.timestamp, ['ms']);
    const myTrades = await this.exchange.fetchMyTrades(from);
    const orderIDs = map(this.transactions, 'id');
    const trades = sortBy(
      filter(myTrades, t => orderIDs.includes(t.id)),
      'timestamp',
    );

    debug(
      'core',
      [`${myTrades.length} trades used to fill sticky order.`, `First trade started at: ${toISOString(from)}.`].join(
        ' ',
      ),
    );

    if (!trades.length) throw new GekkoError('core', 'No trades found in order');

    const amounts = map(trades, 'amount');
    const feePercents = reject(map(trades, 'fee.rate'), isNil);

    return {
      amount: sumBy(trades, 'amount'),
      price: weightedMean(map(trades, 'price'), amounts),
      feePercent: feePercents.length ? weightedMean(feePercents, amounts) : undefined,
      side: this.side,
      date: last(trades)?.timestamp,
    };
  }

  private async checkOrder() {
    debug('core', `Starting checking order ${this.id} status`);

    // If completed or canceling execute cancel() to clear interval.
    if (this.isOrderCompleted() || this.completing) return await this.cancel();
    // No check when initializing the order or when already checking the order.
    if (this.getStatus() === 'initializing' || this.checking) return;
    this.checking = true;
    if (this.id) await this.fetchOrder(this.id);
    this.checking = false;
  }

  private async move() {
    debug('core', `Starting moving order ${this.id}`);

    // Ignoring move if cancel order has been given during checking
    if (this.completing || !this.id) return;
    this.moving = true;
    await this.cancelOrder(this.id);

    // If order cancelation is a success let's keep going the move
    if (this.getStatus() !== 'error' && !this.isOrderCompleted()) {
      const filledAmount = sumBy(this.transactions, 'filled');
      await this.createOrder(this.side, this.amount - filledAmount);
    }
    this.moving = false;
  }

  private isOrderPartiallyFilled() {
    return !this.isOrderCompleted() && sumBy(this.transactions, 'filled') > 0;
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }

  private updateTransactionPartialFilledAmount(id: string, filled = 0) {
    const lastFilledValueOfCurrentTransaction = find(this.transactions, { id })?.filled ?? 0;
    if (filled > lastFilledValueOfCurrentTransaction) {
      this.transactions = map(this.transactions, t => ({
        ...t,
        ...(t.id === id && { filled }),
      }));
      this.orderPartiallyFilled(id, filled);
    }
  }

  // Overrided functions
  protected handleCreateOrderSuccess({ id, status, filled, price, remaining, timestamp }: Order) {
    debug(
      'core',
      [
        `Order ${id} created with success.`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    // Updating transactions
    this.transactions = reject(this.transactions, t => t.id === this.id && t.filled === 0);
    this.transactions.push({ id, timestamp, filled });

    // Updating current transaction ID
    this.id = id;

    if (status === 'closed') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    if (filled) this.orderPartiallyFilled(id, filled);

    if (status === 'canceled') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderCanceled(!!filled));
    }

    if (status === 'open') return Promise.resolve(this.setStatus('open'));
    warning('core', `Order creation succeeded, but unknown status (${status}) returned`);
    return Promise.resolve();
  }

  protected handleCreateOrderError(error: unknown) {
    clearInterval(this.interval);

    if (error instanceof OrderOutOfRangeError && this.isOrderPartiallyFilled())
      return Promise.resolve(this.orderFilled());

    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError)
      return Promise.resolve(this.orderRejected(error.message));

    if (error instanceof Error) this.orderErrored(error);

    throw error;
  }

  protected handleCancelOrderSuccess({ id, status, filled, remaining, timestamp, price }: Order) {
    debug(
      'core',
      [
        `Order ${id} canceled with success.`,
        `Order is moving: ${this.moving};`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    const totalFilledOfAllTransactions = sumBy(this.transactions, 'filled') + (filled ?? 0);
    if (remaining === 0 || this.amount === totalFilledOfAllTransactions) {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    // No need to clear interval here, it will be done in cancel function
    if (!this.moving) this.orderCanceled(totalFilledOfAllTransactions > 0);
    return Promise.resolve();
  }

  protected handleCancelOrderError(error: Error) {
    // Order is not found because it was filled
    if (error instanceof OrderNotFound) {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }
    return Promise.resolve(this.orderErrored(error));
  }

  protected async handleFetchOrderSuccess({ id, status, filled, price, remaining, timestamp }: Order) {
    debug(
      'core',
      [
        `Order ${id} fetched with success.`,
        `Order is moving: ${this.moving};`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    if (status === 'closed') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    if (status === 'canceled') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderCanceled(!!filled));
    }

    if (status === 'open') {
      try {
        const ticker = await this.exchange.fetchTicker();
        const bookSide = this.side === 'buy' ? 'bid' : 'ask';
        debug('core', `Moving order ${id} to ${bookSide} side ${ticker[bookSide]}. Old price: ${price}.`);

        if (price && ticker[bookSide] !== price) await this.move();
      } catch (error) {
        if (error instanceof Error) this.orderErrored(error);
        throw error;
      }
    }
    return Promise.resolve();
  }

  protected handleFetchOrderError(error: Error) {
    return Promise.resolve(this.orderErrored(error));
  }
}
