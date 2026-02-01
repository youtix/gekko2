import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { toISOString } from '@utils/date/date.utils';
import { getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { bindAll, filter } from 'lodash-es';
import { UUID } from 'node:crypto';
import { eventSubscriberSchema } from './eventSubscriber.schema';
import { Event, EVENT_NAMES, EventSubscriberConfig } from './eventSubscriber.types';

export class EventSubscriber extends Plugin {
  private bot: TelegramBot;
  private prices = new Map<TradingPair, number>();
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
          'sub_strat_info - Subscribe to strategy logs',
          'sub_strat_create - Notify on strategy order creation',
          'sub_strat_cancel - Notify on strategy order cancellation',
          'sub_order_init - Notify on order initiation',
          'sub_order_cancel - Notify on order cancellation',
          'sub_order_error - Notify on order error',
          'sub_order_complete - Notify on order completion',
          'subscribe_all - Subscribe to all notifications',
          'unsubscribe_all - Unsubscribe from all notifications',
          'subscriptions - View current subscriptions',
          'help - Show help information',
        ].join('\n');
      case '/subscribe_all':
        EVENT_NAMES.forEach(e => this.subscriptions.add(e));
        return 'Subscribed to all events';
      case '/unsubscribe_all':
        this.subscriptions.clear();
        return 'Unsubscribed from all events';
      case '/subscriptions':
        return this.subscriptions.size ? [...this.subscriptions].join('\n') : 'No subscriptions';
      default:
        if (command.startsWith('/sub_')) {
          const event = command.replace('/sub_', '') as Event;
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
  public async onStrategyInfo(payloads: StrategyInfo[]) {
    await Promise.all(
      payloads.map(({ timestamp, level, tag, message }) => {
        if (!this.subscriptions.has('strat_info')) return;
        const msg = `• ${toISOString(timestamp)} [${level.toUpperCase()}] (${tag})\n${message}\n------\n`;
        this.bot.sendMessage(msg);
      }),
    );
  }

  public async onStrategyCreateOrder(payloads: AdviceOrder[]) {
    await Promise.all(
      payloads.map(({ id, orderCreationDate, side, type, amount, price, symbol }) => {
        if (!this.subscriptions.has('strat_create')) return;
        const [, currency] = symbol.split('/');
        const currentPrice = this.prices.get(symbol);
        const priceLine =
          type === 'LIMIT' ? `Requested limit price: ${price} ${currency}` : `Target price: ${currentPrice ?? 'unknown'} ${currency}`;
        const message = [
          `Order Id: ${id}`,
          `Received ${type} ${side} advice for ${symbol}`,
          `Requested amount: ${amount ?? 'auto'}`,
          `At time: ${toISOString(orderCreationDate)}`,
          priceLine,
        ].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  public async onOrderInitiated(payloads: OrderInitiatedEvent[]) {
    await Promise.all(
      payloads.map(({ order, exchange }) => {
        if (!this.subscriptions.has('order_init')) return;
        const { portfolio } = exchange;
        const { id, amount, side, type, price, orderCreationDate, symbol } = order;
        const [asset, currency] = symbol.split('/');
        const currentPrice = this.prices.get(symbol) ?? 0;
        const priceLine = price ? `Requested limit price: ${price} ${currency}` : `Target price: ${currentPrice} ${currency}`;
        const assetBalance = getAssetBalance(portfolio, asset);
        const currencyBalance = getAssetBalance(portfolio, currency);
        const message = [
          `${side} ${type} order created (${id}) for ${symbol}`,
          `Requested amount: ${amount}`,
          `Current symbol portfolio: ${assetBalance.total} ${asset} / ${currencyBalance.total} ${currency}`,
          priceLine,
          `At time: ${toISOString(orderCreationDate)}`,
        ].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  public async onOrderCanceled(payloads: OrderCanceledEvent[]) {
    await Promise.all(
      payloads.map(({ order }) => {
        if (!this.subscriptions.has('order_cancel')) return;
        const { id, amount, side, type, price, orderCancelationDate, filled, remaining, symbol } = order;
        const [asset, currency] = symbol.split('/');
        const currentPrice = this.prices.get(symbol) ?? 0;
        const priceLine = price ? `Requested limit price: ${price} ${currency}` : `Current price: ${currentPrice} ${currency}`;
        const message = [
          `${side} ${type} order canceled (${id}) for ${symbol}`,
          `At time: ${toISOString(orderCancelationDate)}`,
          `Filled amount: ${filled} / ${amount} ${asset}`,
          `Remaining amount: ${remaining} ${asset}`,
          priceLine,
        ].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  public async onOrderErrored(payloads: OrderErroredEvent[]) {
    await Promise.all(
      payloads.map(({ order }) => {
        if (!this.subscriptions.has('order_error')) return;
        const { id, amount, side, type, reason, orderErrorDate, symbol } = order;
        const [, currency] = symbol.split('/');
        const currentPrice = this.prices.get(symbol) ?? 0;
        const message = [
          `${side} ${type} order errored (${id}) for ${symbol}`,
          `Due to ${reason}`,
          `At time: ${toISOString(orderErrorDate)}`,
          `Requested amount: ${amount}`,
          `Current price: ${currentPrice} ${currency}`,
        ].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  public async onOrderCompleted(payloads: OrderCompletedEvent[]) {
    await Promise.all(
      payloads.map(({ order, exchange }) => {
        if (!this.subscriptions.has('order_complete')) return;
        const { portfolio } = exchange;
        const { id, amount, side, type, orderExecutionDate, effectivePrice, feePercent, fee, symbol } = order;
        const [asset, currency] = symbol.split('/');
        const assetBalance = getAssetBalance(portfolio, asset);
        const currencyBalance = getAssetBalance(portfolio, currency);
        const message = [
          `${side} ${type} order completed (${id}) for ${symbol}`,
          `Amount: ${amount} ${asset}`,
          `Price: ${effectivePrice} ${currency}`,
          `Fee percent: ${feePercent ?? '0'}%`,
          `Fee: ${fee} ${currency}`,
          `At time: ${toISOString(orderExecutionDate)}`,
          `Current portfolio: ${assetBalance.total} ${asset} / ${currencyBalance.total} ${currency}`,
        ].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  public async onStrategyCancelOrder(payloads: UUID[]) {
    await Promise.all(
      payloads.map(id => {
        if (!this.subscriptions.has('strat_cancel')) return;
        const message = ['Strategy requested order cancellation', `Order Id: ${id}`, `At time: ${toISOString(Date.now())}`].join('\n');
        this.bot.sendMessage(message);
      }),
    );
  }

  // --- END LISTENERS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    this.bot.listen();
  }

  protected processOneMinuteBucket(bucket: CandleBucket) {
    for (const [symbol, candle] of bucket) {
      this.prices.set(symbol, candle.close);
    }
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
