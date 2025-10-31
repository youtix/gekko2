import type { OrderCompleted, OrderErrored } from '@models/order.types';
import type { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import type { VolumeDeltaStrategyParams, VolumeDeltaTrend } from './volumeDelta.types';

export class VolumeDelta implements Strategy<VolumeDeltaStrategyParams> {
  private trend?: VolumeDeltaTrend;

  init(addIndicator: AddIndicatorFn, strategyParams: VolumeDeltaStrategyParams): void {
    const { src, signal } = strategyParams;
    addIndicator('VolumeDelta', { src, signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onCandleAfterWarmup(
    { createOrder, log, strategyParams }: Tools<VolumeDeltaStrategyParams>,
    indicator: IndicatorRegistry['VolumeDelta']['output'],
  ): void {
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

  log({ log }: Tools<VolumeDeltaStrategyParams>, indicator: IndicatorRegistry['VolumeDelta']['output']): void {
    if (indicator === null) return;
    log('debug', `volumeDelta: ${indicator.volumeDelta?.toFixed(8)}`);
    log('debug', `macd: ${indicator.macd?.toFixed(8)}`);
    log('debug', `signal: ${indicator.signal?.toFixed(8)}`);
    log('debug', `hist: ${indicator.hist?.toFixed(8)}`);
  }

  // NOT USED
  onEachCandle(_tools: Tools<VolumeDeltaStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_order: OrderCompleted): void {}
  onOrderErrored(_order: OrderErrored): void {}
  end(): void {}
}
