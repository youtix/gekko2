import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Watch } from '@models/configuration.types';
import { OrderSide, OrderState, OrderType } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { ExchangeNetworkError } from '@services/exchange/exchange.error';
import { Exchange, OrderSettledCallback } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { debug, error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { isNil, sumBy } from 'lodash-es';
import { UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { OrderCancelDetails, OrderCancelEventPayload, OrderStatus, OrderSummary, Transaction } from './order.types';
import { createOrderSummary, toError } from './order.utils';

export abstract class Order extends EventEmitter {
  private status: OrderStatus;
  protected readonly transactions: Map<string, Transaction>;
  protected readonly exchange: Exchange;
  protected readonly type: OrderType;
  protected readonly side: OrderSide;
  protected readonly gekkoOrderId: UUID;
  protected readonly mode: Watch['mode'];
  protected readonly symbol: TradingPair;
  // The id the exchange gave the order, known from its first state (see recordOrderUpdate). A STICKY order places one transaction
  // after the other: the id of the current one.
  protected id?: string;
  // Polls the order in realtime (see the subclasses), until it is over (see setStatus)
  protected interval?: Timer;

  constructor(symbol: TradingPair, gekkoOrderId: UUID, side: OrderSide, type: OrderType) {
    super();
    const { mode } = config.getWatch();
    this.exchange = inject.exchange();
    this.status = 'initializing';
    this.transactions = new Map();
    this.type = type;
    this.side = side;
    this.gekkoOrderId = gekkoOrderId;
    this.mode = mode;
    this.symbol = symbol;
  }

  public getGekkoOrderId() {
    return this.gekkoOrderId;
  }

  /**
   * What the order has executed, as far as the exchange reported it: the cumulative fills of its transactions added up (a STICKY
   * order places one after the other). 0 while none is reported, and an exchange may answer an order without its fill (see
   * recordOrderUpdate). The Trader estimates the summary of a fill from it when the exchange cannot give one.
   */
  public getFilledAmount() {
    return sumBy(Array.from(this.transactions.values()), ({ filled }) => filled ?? 0);
  }

  /**
   * In backtest nothing polls the order: the simulated exchange settles it when a candle reaches its price, and reports the fill
   * through onSettled. A real exchange ignores it.
   */
  protected async createLimitOrder(side: OrderSide, amount: number, price: number, onSettled?: OrderSettledCallback) {
    try {
      info('order', `[${this.gekkoOrderId}] Creating ${side} limit order with amount: ${amount} and price ${price}`);
      const order = await this.exchange.createLimitOrder(this.symbol, side, amount, price, onSettled);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async createMarketOrder(side: OrderSide, amount: number) {
    try {
      info('order', `[${this.gekkoOrderId}] Creating ${side} market order with amount: ${amount}`);
      const order = await this.exchange.createMarketOrder(this.symbol, side, amount);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  /**
   * Sends the cancelation, then hands the answer to handleCancelOrderSuccess, or the failure to handleCancelOrderError. An answer is
   * not the end of the order: the state it carries may be 'canceled', 'closed' (executed in full first), or still 'open', when the
   * exchange has not completed the cancelation yet (see Exchange.cancelOrder). Whether the order has ended is its status
   * (isOrderCompleted), which the handlers set.
   */
  protected async cancelOrder(id: string) {
    try {
      info('order', `[${this.gekkoOrderId}] Canceling ${this.side} ${this.type} order.`);
      const order = await this.exchange.cancelOrder(this.symbol, id);
      await this.handleCancelOrderSuccess(order);
    } catch (error) {
      await this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      info('order', `[${this.gekkoOrderId}] Fetching ${this.side} ${this.type} order`);
      const order = await this.exchange.fetchOrder(this.symbol, id);
      await this.handleFetchOrderSuccess(order);
    } catch (error) {
      await this.handleFetchOrderError(error);
    }
  }

  protected getStatus() {
    return this.status;
  }

  protected setStatus(status: OrderStatus, reason?: string) {
    this.status = status;
    // An order that is over is polled no more, whichever path ended it
    if (this.isOrderCompleted()) clearInterval(this.interval);
    this.emit(ORDER_STATUS_CHANGED_EVENT, { status, reason });
    if (reason) error('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order ${status}: ${reason}`);
    else debug('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order ${status}`);
  }

  protected orderCanceled({ filled, remaining, price, timestamp }: OrderCancelDetails) {
    this.setStatus('canceled');
    this.emit<OrderCancelEventPayload>(ORDER_CANCELED_EVENT, {
      status: this.status,
      ...(!isNil(filled) && { filled }),
      ...(!isNil(remaining) && { remaining }),
      ...(!isNil(price) && { price }),
      timestamp,
    });
  }

  protected orderRejected(reason: string) {
    this.setStatus('rejected', reason);
    // Whether it executed part of what it ordered before: the relaunch of a STICKY order is refused after fills (see StickyOrder)
    this.emit(ORDER_INVALID_EVENT, { status: this.status, filled: this.getFilledAmount() > 0, reason });
  }

  // The cumulative fill of the current transaction has grown (see recordOrderUpdate)
  protected orderPartiallyFilled(filled: number) {
    this.emit(ORDER_PARTIALLY_FILLED_EVENT, filled);
  }

  protected orderFilled() {
    this.setStatus('filled');
    this.emit(ORDER_COMPLETED_EVENT, { status: this.status, filled: true });
  }

  protected orderErrored(error: Error) {
    this.setStatus('error', error.message);
    this.emit(ORDER_ERRORED_EVENT, error.message);
  }

  /**
   * Whether the order is over. 'error' is final too: an errored order is no longer polled, nor canceled, so that a failure is
   * neither sent again forever nor reported twice.
   */
  protected isOrderCompleted() {
    return ['rejected', 'canceled', 'filled', 'error'].includes(this.getStatus());
  }

  /**
   * Whether a state reported for the order arrives after its end, to be ignored: the simulated exchange settling it in backtest (the
   * onSettled callback of createLimitOrder), or the answer to a call sent before it ended. An order that is over stays so: such a
   * state would bring it back to 'open', or end it a second time (ORDER_COMPLETED_EVENT after ORDER_CANCELED_EVENT or
   * ORDER_ERRORED_EVENT). It is only logged, at debug level.
   */
  protected isLateUpdate({ id, status }: Pick<OrderState, 'id' | 'status'>) {
    if (!this.isOrderCompleted()) return false;
    const update = `transaction ${id} ${status}`;
    debug(
      'order',
      `[${this.gekkoOrderId}] ${this.side} ${this.type} order update ignored (${update}), the order is already ${this.getStatus()}`,
    );
    return true;
  }

  /**
   * Records a state the exchange reported for the order: the answer to its creation, to a poll or to a cancelation, or its settlement
   * by the simulated exchange in backtest. Nothing is recorded, and false returned, for a state without an id, which cannot be
   * followed, or arriving after the end of the order (see isLateUpdate).
   * The transaction keeps the first timestamp known: the trades of the order are fetched from there (createOrderSummary), and a later
   * state may carry the time of its last update, or no time at all, read as now (mapCcxtOrderToOrder): after the fills. Its fill is
   * cumulative, and always a number: a state that reports none, or less than already recorded (the answer to a cancelation after a
   * poll), leaves it as it is. ORDER_PARTIALLY_FILLED_EVENT is emitted when it grows.
   */
  protected recordOrderUpdate(order: OrderState) {
    const { id, status, filled, remaining, price, timestamp } = order;
    if (!id || this.isLateUpdate(order)) return false;

    const details = `filled: ${filled}, remaining: ${remaining}, price: ${price}, at ${toISOString(timestamp)}`;
    debug('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order update: transaction ${id} ${status}, ${details}`);

    const transaction = this.transactions.get(id);
    const recordedFill = transaction?.filled ?? 0;
    const reportedFill = filled ?? 0;
    const isFillGrowing = reportedFill > recordedFill;

    this.id = id;
    this.transactions.set(id, {
      id,
      timestamp: transaction?.timestamp ?? timestamp,
      filled: isFillGrowing ? reportedFill : recordedFill,
      status,
    });
    if (isFillGrowing) this.orderPartiallyFilled(reportedFill);
    return true;
  }

  /**
   * Applies a state the exchange reported for the order, once recorded (see recordOrderUpdate): executed in full ('closed'), the order
   * is filled; canceled, see handleTransactionCanceled; open, the order is open, which is reported once per transaction. Those are the
   * only statuses a state carries (see processStatus in exchange.utils).
   */
  protected applyOrderUpdate(order: OrderState): void | Promise<void> {
    const previousStatus = this.transactions.get(order.id)?.status;
    if (!this.recordOrderUpdate(order)) return;

    const { status, filled = 0, remaining = 0, price, timestamp } = order;
    switch (status) {
      case 'closed':
        return this.orderFilled();
      case 'canceled':
        return this.handleTransactionCanceled({ filled, remaining, price, timestamp });
      case 'open':
        if (previousStatus !== 'open') this.setStatus('open');
    }
  }

  /**
   * The transaction reported canceled, its fill recorded: the order is canceled with it, whoever canceled it (the strategy, or the
   * exchange: expired, canceled from its interface...). A STICKY order, which places one transaction after the other, overrides it.
   */
  protected handleTransactionCanceled(cancelation: OrderCancelDetails): void | Promise<void> {
    this.orderCanceled(cancelation);
  }

  /**
   * Whether a poll or a cancelation failed in a way that leaves the order as it was. An ExchangeNetworkError is a transport failure
   * (timeout, 5xx, rate limit) that outlived the retries of a read, or hit a cancelation, which is never replayed: it says nothing of
   * the order, which may well be live. It is logged as a warning and the order keeps its status, for the next check to poll, or
   * cancel, again. Any other failure (the exchange no longer knows the order, refuses the credentials...) is final.
   */
  protected isTransientFailure(err: unknown, action: 'poll' | 'cancelation') {
    if (!(err instanceof ExchangeNetworkError)) return false;
    const status = this.getStatus();
    warning(
      'order',
      `[${this.gekkoOrderId}] ${this.side} ${this.type} order ${action} failed on the network, it stays ${status}: ${err.message}`,
    );
    return true;
  }

  /**
   * The error an order ends with when its creation failed without being refused. A creation is sent once and never replayed: after
   * an ExchangeNetworkError its outcome is unknown, and the order may be live on the exchange. Strategies place an order again on
   * ORDER_ERRORED_EVENT: the reason warns them.
   */
  protected toCreationError(err: unknown) {
    if (!(err instanceof ExchangeNetworkError)) return toError(err);
    const reason = `Outcome unknown: the order may be live on the exchange, check it before placing it again (${err.message})`;
    return new Error(reason, { cause: err });
  }

  public async createSummary(): Promise<OrderSummary> {
    // An errored order is over too, but what it executed is unknown: there is nothing to summarize
    if (!this.isOrderCompleted() || this.getStatus() === 'error')
      throw new GekkoError('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order is not completed`);

    return createOrderSummary({
      id: this.gekkoOrderId,
      symbol: this.symbol,
      exchange: this.exchange,
      type: this.type,
      side: this.side,
      transactions: Array.from(this.transactions.values()),
    });
  }

  public abstract cancel(): Promise<void>;
  public abstract checkOrder(): Promise<void>;
  public abstract launch(): Promise<void>;

  protected abstract handleCancelOrderSuccess(order: OrderState): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: OrderState): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: OrderState): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
