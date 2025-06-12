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
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import Big from 'big.js';
import { formatDuration, intervalToDuration } from 'date-fns';
import { filter, upperCase } from 'lodash-es';
import { TELEGRAM_API_BASE_URL } from './telegram.const';
import { telegramSchema } from './telegram.schema';
import { TelegramConfig } from './telegram.types';

export class Telegram extends Plugin {
  private token: string;
  private chatId: string;
  private price?: number;

  constructor({ chatId, token }: TelegramConfig) {
    super(Telegram.name);
    this.token = token;
    this.chatId = chatId;
  }

  // --- BEGIN LISTENERS ---
  public onAdvice({ recommendation, date }: Advice) {
    const message = [
      `Received advice to go ${recommendation}`,
      `At time: ${toISOString(date)}`,
      `Target price: ${this.price}`,
    ].join('\n');
    this.sendMessage(this.token, this.chatId, message);
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
    this.sendMessage(this.token, this.chatId, message);
  }

  public onTradeCanceled({ id, date, adviceId }: TradeCanceled) {
    const message = [
      `Sticky order canceled (${id})`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.token, this.chatId, message);
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
    this.sendMessage(this.token, this.chatId, message);
  }

  public onTradeErrored({ adviceId, date, id, reason }: TradeErrored) {
    const message = [
      `Sticky order errored (${id})`,
      `Due to ${reason}`,
      `At time: ${toISOString(date)}`,
      `Current price: ${this.price} ${this.currency}`,
      `Advice: ${adviceId}`,
    ].join('\n');
    this.sendMessage(this.token, this.chatId, message);
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
    this.sendMessage(this.token, this.chatId, message);
  }

  public onRoundtrip({ duration, entryAt, exitAt, pnl, profit, maxAdverseExcursion }: RoundTrip) {
    const formater = new Intl.NumberFormat();
    const message = [
      `Roundtrip done from ${toISOString(entryAt)} to ${toISOString(exitAt)}`,
      `Exposed Duration: ${formatDuration(intervalToDuration({ start: 0, end: duration }))}`,
      `Profit & Loss: ${formater.format(pnl)} ${this.currency}`,
      `Profit percent: ${+Big(profit).round(2, Big.roundDown)}%`,
      `MAE: ${formater.format(maxAdverseExcursion)} ${this.currency}`,
    ].join('\n');
    this.sendMessage(this.token, this.chatId, message);
  }
  // --- END LISTENERS ---

  private sendMessage(token: string, chatId: string, message: string) {
    const url = `${TELEGRAM_API_BASE_URL}${token}/sendMessage`;
    const payload = { chat_id: chatId, text: message };

    debug('telegram', `Sending POST HTTP request to ${url} with payload ${JSON.stringify(payload)}`);

    try {
      return this.getFetcher().post({ url, payload });
    } catch {
      return; // Don't stop the music if we can't send the message
    }
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processCandle(candle: Candle) {
    this.price = candle.close;
  }

  protected processFinalize() {
    /* noop */
  }

  public static getStaticConfiguration() {
    return {
      schema: telegramSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: ['fetcher'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Telegram.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
      name: 'Telegram',
    };
  }
}
