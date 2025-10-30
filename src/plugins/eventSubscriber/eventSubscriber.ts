import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderAborted, OrderCanceled, OrderCompleted, OrderErrored, OrderInitiated } from '@models/order.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { toISOString } from '@utils/date/date.utils';
import { bindAll, filter, upperCase } from 'lodash-es';
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

  public onStrategyCreateOrder({ order, date }: Advice) {
    if (!this.subscriptions.has('strategy_advice')) return;
    const message = [
      `Received ${order.type} ${order.side} advice`,
      `Requested quantity: ${order.quantity ?? 'auto'}`,
      `At time: ${toISOString(date)}`,
      `Target price: ${this.price}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderInitiated({
    side: action,
    balance,
    date,
    orderId: id,
    orderId: adviceId,
    orderType,
    portfolio,
    requestedAmount,
  }: OrderInitiated) {
    if (!this.subscriptions.has('trade_initiated')) return;
    const message = [
      `${upperCase(action)} ${orderType} order created (${id})`,
      `Requested amount: ${requestedAmount}`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Target price: ${this.price}`,
      `At time: ${toISOString(date)}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderCanceled({ orderId: id, date, orderId: adviceId, orderType }: OrderCanceled) {
    if (!this.subscriptions.has('trade_canceled')) return;
    const message = [
      `${orderType} order canceled (${id})`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderAborted({
    orderId: id,
    side: action,
    orderId: adviceId,
    balance,
    date,
    portfolio,
    reason,
    orderType,
  }: OrderAborted) {
    if (!this.subscriptions.has('trade_aborted')) return;
    const message = [
      `${upperCase(action)} ${orderType} order aborted (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderErrored({ orderId: adviceId, date, orderId: id, reason, orderType }: OrderErrored) {
    if (!this.subscriptions.has('trade_errored')) return;
    const message = [
      `${orderType} order errored (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onOrderCompleted({
    side: action,
    orderId: adviceId,
    amount,
    balance,
    cost,
    date,
    effectivePrice,
    feePercent,
    orderId: id,
    portfolio,
    orderType,
  }: OrderCompleted) {
    if (!this.subscriptions.has('trade_completed')) return;
    const message = [
      `${upperCase(action)} ${orderType} order completed (${id})`,
      `Amount: ${amount} ${this.asset}`,
      `Price: ${effectivePrice} ${this.currency}`,
      `Fee percent: ${feePercent ?? '0'}%`,
      `Cost: ${cost} ${this.currency}`,
      `At time: ${toISOString(date)}`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Advice: ${adviceId}`,
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
      schema: eventSubscriberSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(EventSubscriber.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
      name: 'EventSubscriber',
    };
  }
}
