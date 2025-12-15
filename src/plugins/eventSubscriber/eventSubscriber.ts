import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { toISOString } from '@utils/date/date.utils';
import { bindAll, filter } from 'lodash-es';
import { eventSubscriberSchema } from './eventSubscriber.schema';
import { Event, EVENT_NAMES, EventSubscriberConfig } from './eventSubscriber.types';

export class EventSubscriber extends Plugin {
  private bot: TelegramBot;
  private price?: number;
  private subscriptions = new Set<Event>();

  constructor({ name, token, botUsername }: EventSubscriberConfig) {
    super(name);
    bindAll(this, ['handleCommand']);
    this.bot = new TelegramBot(token, botUsername, this.handleCommand);
  }

  private handleCommand(command: string): string {
    switch (command) {
      case '/help':
        return [
          'Available commands:',
          ...EVENT_NAMES.map(e => `/subscribe_to_${e}`),
          '/subscribe_to_all',
          '/unsubscribe_from_all',
          '/subscriptions',
          '/help',
        ].join('\n');
      case '/subscribe_to_all':
        EVENT_NAMES.forEach(e => this.subscriptions.add(e));
        return 'Subscribed to all events';
      case '/unsubscribe_from_all':
        this.subscriptions.clear();
        return 'Unsubscribed from all events';
      case '/subscriptions':
        return this.subscriptions.size ? [...this.subscriptions].join('\n') : 'No subscriptions';
      default:
        if (command.startsWith('/subscribe_to_')) {
          const event = command.replace('/subscribe_to_', '') as Event;
          if (!EVENT_NAMES.includes(event)) return 'Unknown command';
          if (this.subscriptions.has(event)) {
            this.subscriptions.delete(event);
            return `Unsubscribed from ${event}`;
          }
          this.subscriptions.add(event);
          return `Subscribed to ${event}`;
        }
        return 'Unknown command';
    }
  }

  // --- BEGIN LISTENERS ---
  public onStrategyInfo({ timestamp, level, tag, message }: StrategyInfo) {
    if (!this.subscriptions.has('strategy_info')) return;
    const msg = `• ${toISOString(timestamp)} [${level.toUpperCase()}] (${tag})\n${message}\n------\n`;
    this.bot.sendMessage(msg);
  }

  public onStrategyCreateOrder({ id, orderCreationDate, side, type, amount, price }: AdviceOrder) {
    if (!this.subscriptions.has('strategy_advice')) return;
    const priceLine =
      type === 'LIMIT'
        ? `Requested limit price: ${price} ${this.currency}`
        : `Target price: ${this.price ?? 'unknown'} ${this.currency}`;
    const message = [
      `Order Id: ${id}`,
      `Received ${type} ${side} advice`,
      `Requested amount: ${amount ?? 'auto'}`,
      `At time: ${toISOString(orderCreationDate)}`,
      priceLine,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderInitiated({ order, exchange }: OrderInitiatedEvent) {
    if (!this.subscriptions.has('order_initiated')) return;
    const { balance, portfolio, price: currentPrice } = exchange;
    const { id, amount, side, type, price, orderCreationDate } = order;
    const priceLine = price
      ? `Requested limit price: ${price} ${this.currency}`
      : `Target price: ${currentPrice} ${this.currency}`;
    const message = [
      `${side} ${type} order created (${id})`,
      `Requested amount: ${amount}`,
      `Current portfolio: ${portfolio.asset.total} ${this.asset} / ${portfolio.currency.total} ${this.currency}`,
      `Current balance: ${balance.total}`,
      priceLine,
      `At time: ${toISOString(orderCreationDate)}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderCanceled({ order, exchange }: OrderCanceledEvent) {
    if (!this.subscriptions.has('order_canceled')) return;
    const { price: currentPrice } = exchange;
    const { id, amount, side, type, price, orderCancelationDate, filled, remaining } = order;
    const priceLine = price
      ? `Requested limit price: ${price} ${this.currency}`
      : `Current price: ${currentPrice} ${this.currency}`;
    const message = [
      `${side} ${type} order canceled (${id})`,
      `At time: ${toISOString(orderCancelationDate)}`,
      `Filled amount: ${filled} / ${amount} ${this.asset}`,
      `Remaining amount: ${remaining} ${this.asset}`,
      priceLine,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderErrored({ order }: OrderErroredEvent) {
    if (!this.subscriptions.has('order_errored')) return;
    const { id, amount, side, type, reason, orderErrorDate } = order;
    const message = [
      `${side} ${type} order errored (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(orderErrorDate)}`,
      `Requested amount: ${amount}`,
      `Current price: ${this.price} ${this.currency}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderCompleted({ order, exchange }: OrderCompletedEvent) {
    if (!this.subscriptions.has('order_completed')) return;
    const { portfolio, balance } = exchange;
    const { id, amount, side, type, orderExecutionDate, effectivePrice, feePercent, fee } = order;
    const message = [
      `${side} ${type} order completed (${id})`,
      `Amount: ${amount} ${this.asset}`,
      `Price: ${effectivePrice} ${this.currency}`,
      `Fee percent: ${feePercent ?? '0'}%`,
      `Fee: ${fee} ${this.currency}`,
      `At time: ${toISOString(orderExecutionDate)}`,
      `Current portfolio: ${portfolio.asset.total} ${this.asset} / ${portfolio.currency.total} ${this.currency}`,
      `Current balance: ${balance}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  // --- END LISTENERS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    this.bot.listen();
  }

  protected processOneMinuteCandle(candle: Candle) {
    this.price = candle.close;
  }

  protected processFinalize() {
    this.bot.close();
  }

  public static getStaticConfiguration() {
    return {
      name: 'EventSubscriber',
      schema: eventSubscriberSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(EventSubscriber.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
    } as const;
  }
}
