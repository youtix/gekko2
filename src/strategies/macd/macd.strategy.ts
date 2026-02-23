import { TradingPair } from '@models/utility.types';
import { InitParams, OnCandleEventParams, Strategy } from '@strategies/strategy.types';
import { pluralize } from '@utils/string/string.utils';
import { isNumber, isObject } from 'lodash-es';
import { MACDStrategyParams, MACDTrend } from './macd.types';

export class MACD implements Strategy<MACDStrategyParams> {
  private trend?: MACDTrend;
  private pair?: TradingPair;

  init({ candle, tools, addIndicator }: InitParams<MACDStrategyParams>): void {
    const { strategyParams } = tools;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('MACD', this.pair, { short: strategyParams.short, long: strategyParams.long, signal: strategyParams.signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<MACDStrategyParams>, ...indicators: unknown[]): void {
    const { strategyParams, log, createOrder } = tools;
    const { macdSrc } = strategyParams;
    const [macd] = indicators;

    if (!this.isMacd(macd) || !this.pair) return;

    if (macd[macdSrc] > strategyParams.thresholds.up) {
      if (this.trend?.direction !== 'up') {
        log('info', 'MACD: up trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'up', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In uptrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
      }
    } else if (macd[macdSrc] < strategyParams.thresholds.down) {
      if (this.trend?.direction !== 'down') {
        log('info', 'MACD: down trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'down', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In downtrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
      }
    } else {
      log('debug', 'MACD: no trend detected');
    }
  }

  log({ tools }: OnCandleEventParams<MACDStrategyParams>, ...indicators: unknown[]): void {
    const { log } = tools;
    const [macd] = indicators;
    if (!this.isMacd(macd)) return;

    log('debug', `macd: ${macd.macd.toFixed(8)}`);
    log('debug', `signal: ${macd.signal.toFixed(8)}`);
    log('debug', `hist: ${macd.hist.toFixed(8)}`);
  }

  private isMacd(data: unknown): data is { macd: number; signal: number; hist: number } {
    return (
      isObject(data) &&
      'macd' in data &&
      'signal' in data &&
      'hist' in data &&
      isNumber(data.macd) &&
      isNumber(data.signal) &&
      isNumber(data.hist)
    );
  }
}
