import { OrderCanceled, OrderCompleted, OrderErrored } from '@models/order.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { pluralize } from '@utils/string/string.utils';
import { isNumber, isObject } from 'lodash-es';
import { MACDStrategyParams, MACDTrend } from './macd.types';

export class MACD implements Strategy<MACDStrategyParams> {
  private trend?: MACDTrend;

  init(addIndicator: AddIndicatorFn, strategyParams: MACDStrategyParams): void {
    addIndicator('MACD', { short: strategyParams.short, long: strategyParams.long, signal: strategyParams.signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onCandleAfterWarmup({ strategyParams, createOrder, log }: Tools<MACDStrategyParams>, ...indicators: unknown[]): void {
    const { macdSrc } = strategyParams;
    const [macd] = indicators;

    if (!this.isMacd(macd)) return;

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
        createOrder({ type: 'STICKY', side: 'BUY' });
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
        createOrder({ type: 'STICKY', side: 'SELL' });
      }
    } else {
      log('debug', 'MACD: no trend detected');
    }
  }

  log({ log }: Tools<MACDStrategyParams>, ...indicators: unknown[]): void {
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

  // NOT USED
  onEachCandle(_tools: Tools<MACDStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_order: OrderCompleted): void {}
  onOrderCanceled(_order: OrderCanceled): void {}
  onOrderErrored(_order: OrderErrored): void {}
  end(): void {}
}
