import type {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import type { VolumeDeltaStrategyParams, VolumeDeltaTrend } from './volumeDelta.types';

export class VolumeDelta implements Strategy<VolumeDeltaStrategyParams> {
  private trend?: VolumeDeltaTrend;

  init({ tools, addIndicator }: InitParams<VolumeDeltaStrategyParams>): void {
    const { src, signal } = tools.strategyParams;
    addIndicator('VolumeDelta', { src, signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<VolumeDeltaStrategyParams>,
    indicator: IndicatorRegistry['VolumeDelta']['output'],
  ): void {
    const { strategyParams, log, createOrder } = tools;
    const { output } = strategyParams;
    if (indicator === null || indicator[output] === null) return;

    if (indicator[output] > strategyParams.thresholds.up) {
      if (this.trend?.direction !== 'up') {
        log('info', 'VolumeDelta: up trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'up', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In uptrend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'BUY' });
      }
    } else if (indicator[output] < strategyParams.thresholds.down) {
      if (this.trend?.direction !== 'down') {
        log('info', 'VolumeDelta: down trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'down', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In downtrend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        createOrder({ type: 'STICKY', side: 'SELL' });
      }
    } else {
      log('debug', 'VolumeDelta: no trend detected');
    }
  }

  log(
    { tools }: OnCandleEventParams<VolumeDeltaStrategyParams>,
    indicator: IndicatorRegistry['VolumeDelta']['output'],
  ): void {
    const { log } = tools;
    if (indicator === null) return;
    log('debug', `volumeDelta: ${indicator.volumeDelta?.toFixed(8)}`);
    log('debug', `macd: ${indicator.macd?.toFixed(8)}`);
    log('debug', `signal: ${indicator.signal?.toFixed(8)}`);
    log('debug', `hist: ${indicator.hist?.toFixed(8)}`);
  }

  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<VolumeDeltaStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<VolumeDeltaStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<VolumeDeltaStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<VolumeDeltaStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
