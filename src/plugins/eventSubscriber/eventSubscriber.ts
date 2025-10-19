import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { RoundTrip } from '@models/roundtrip.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { TradeAborted, TradeCanceled, TradeCompleted, TradeErrored, TradeInitiated } from '@models/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
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

  public onStrategyAdvice({ recommendation, date }: Advice) {
    if (!this.subscriptions.has('strategy_advice')) return;
    const message = [
      `Received advice to go ${recommendation}`,
      `At time: ${toISOString(date)}`,
      `Target price: ${this.price}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onTradeInitiated({ action, balance, date, id, adviceId, portfolio }: TradeInitiated) {
    if (!this.subscriptions.has('trade_initiated')) return;
    const message = [
      `${upperCase(action)} sticky order created (${id})`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Target price: ${this.price}`,
      `At time: ${toISOString(date)}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onTradeCanceled({ id, date, adviceId }: TradeCanceled) {
    if (!this.subscriptions.has('trade_canceled')) return;
    const message = [
      `Sticky order canceled (${id})`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onTradeAborted({ id, action, adviceId, balance, date, portfolio, reason }: TradeAborted) {
    if (!this.subscriptions.has('trade_aborted')) return;
    const message = [
      `${upperCase(action)} sticky order aborted (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onTradeErrored({ adviceId, date, id, reason }: TradeErrored) {
    if (!this.subscriptions.has('trade_errored')) return;
    const message = [
      `Sticky order errored (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.bot.sendMessage(message);
  }

  public onTradeCompleted({
    action,
    adviceId,
    amount,
    balance,
    cost,
    date,
    effectivePrice,
    feePercent,
    id,
    portfolio,
  }: TradeCompleted) {
    if (!this.subscriptions.has('trade_completed')) return;
    const message = [
      `${upperCase(action)} sticky order completed (${id})`,
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

  public onRoundtrip({ duration, entryAt, exitAt, pnl, profit, maxAdverseExcursion }: RoundTrip) {
    const formater = new Intl.NumberFormat();
    if (!this.subscriptions.has('roundtrip')) return;
    const message = [
      `Roundtrip done from ${toISOString(entryAt)} to ${toISOString(exitAt)}`,
      `Exposed Duration: ${formatDuration(intervalToDuration({ start: 0, end: duration }))}`,
      `Profit & Loss: ${formater.format(pnl)} ${this.currency}`,
      `Profit percent: ${round(profit, 2, 'down')}%`,
      `MAE: ${round(maxAdverseExcursion, 2, 'down')}%`,
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
