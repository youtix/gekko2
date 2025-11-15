import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { pluralize } from '@utils/string/string.utils';
import { isNumber } from 'lodash-es';
import { RSICurrentTrend, RSIStrategyParams } from './rsi.types';

export class RSI implements Strategy<RSIStrategyParams> {
  private trend: RSICurrentTrend;

  constructor() {
    this.trend = { direction: 'none', duration: 0, adviced: false };
  }

  init({ tools, addIndicator }: InitParams<RSIStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    addIndicator('RSI', { period, src });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<RSIStrategyParams>, ...indicators: unknown[]): void {
    const { strategyParams, log, createOrder } = tools;
    const [rsi] = indicators;
    if (!isNumber(rsi)) return;
    const { thresholds } = strategyParams;

    if (rsi > thresholds.high) {
      if (this.trend.direction !== 'high') {
        log('info', 'RSI: high trend detected');
        this.trend = { duration: 0, direction: 'high', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In high trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'SELL' });
      }
    } else if (rsi < thresholds.low) {
      if (this.trend.direction !== 'low') {
        log('info', 'RSI: low trend detected');
        this.trend = { duration: 0, direction: 'low', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In low trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'BUY' });
      }
    }
  }

  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  log(_params: OnCandleEventParams<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
