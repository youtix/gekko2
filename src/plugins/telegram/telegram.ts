import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { RoundTrip } from '@models/types/roundtrip.types';
import {
  TradeAborted,
  TradeCanceled,
  TradeCompleted,
  TradeErrored,
  TradeInitiated,
} from '@models/types/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { filter, upperCase } from 'lodash-es';
import { telegramSchema } from './telegram.schema';
import { TelegramConfig } from './telegram.types';

export class Telegram extends Plugin {
  private bot: TelegramBot;
  private chatId: number;
  private price?: number;

  constructor({ name, chatId, token }: TelegramConfig) {
    super(name);
    this.bot = new TelegramBot(token);
    this.chatId = chatId;
  }

  // --- BEGIN LISTENERS ---
  public onStrategyAdvice({ recommendation, date }: Advice) {
    const message = [
      `Received advice to go ${recommendation}`,
      `At time: ${toISOString(date)}`,
      `Target price: ${this.price}`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
  }

  public onTradeInitiated({ action, balance, date, id, adviceId, portfolio }: TradeInitiated) {
    const message = [
      `${upperCase(action)} sticky order created (${id})`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Target price: ${this.price}`,
      `At time: ${toISOString(date)}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
  }

  public onTradeCanceled({ id, date, adviceId }: TradeCanceled) {
    const message = [
      `Sticky order canceled (${id})`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
  }

  public onTradeAborted({ id, action, adviceId, balance, date, portfolio, reason }: TradeAborted) {
    const message = [
      `${upperCase(action)} sticky order aborted (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current portfolio: ${portfolio.asset} ${this.asset} / ${portfolio.currency} ${this.currency}`,
      `Current balance: ${balance}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
  }

  public onTradeErrored({ adviceId, date, id, reason }: TradeErrored) {
    const message = [
      `Sticky order errored (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
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
    this.sendMessage(this.chatId, message);
  }

  public onRoundtrip({ duration, entryAt, exitAt, pnl, profit, maxAdverseExcursion }: RoundTrip) {
    const formater = new Intl.NumberFormat();
    const message = [
      `Roundtrip done from ${toISOString(entryAt)} to ${toISOString(exitAt)}`,
      `Exposed Duration: ${formatDuration(intervalToDuration({ start: 0, end: duration }))}`,
      `Profit & Loss: ${formater.format(pnl)} ${this.currency}`,
      `Profit percent: ${round(profit, 2, 'down')}%`,
      `MAE: ${round(maxAdverseExcursion, 2, 'down')}%`,
    ].join('\n');
    this.sendMessage(this.chatId, message);
  }
  // --- END LISTENERS ---

  private async sendMessage(chatId: number, message: string) {
    debug('telegram', `Sending Message to group ${chatId} via POST HTTP request with text ${message}`);

    try {
      return await this.bot.sendMessage(chatId, message);
    } catch {
      return; // Don't stop the music if we can't send the message
    }
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /** Nothing to do */
  }

  protected processOneMinuteCandle(candle: Candle) {
    this.price = candle.close;
  }

  protected processFinalize() {
    /** Nothing to do */
  }

  public static getStaticConfiguration() {
    return {
      schema: telegramSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(Telegram.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
      name: 'Telegram',
    };
  }
}
