import { OrderCanceled, OrderCompleted, OrderErrored } from '@models/order.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI implements Strategy<CCIStrategyParams> {
  private trend: CCITrend;

  constructor() {
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  init({ strategyParams }: Tools<CCIStrategyParams>, addIndicator: AddIndicatorFn): void {
    addIndicator('CCI', { period: strategyParams.period });
  }

  onCandleAfterWarmup(
    { createOrder, strategyParams: strategySettings, log }: Tools<CCIStrategyParams>,
    ...indicators: unknown[]
  ): void {
    const [cci] = indicators;
    if (!isNumber(cci)) return;

    const { up, down, persistence } = strategySettings.thresholds;

    if (cci >= up) {
      if (this.trend.direction !== 'overbought') {
        log('info', 'CCI: overbought trend detected');
        this.trend = { direction: 'overbought', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          createOrder({ type: 'STICKY', side: 'SELL' });
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          createOrder({ type: 'STICKY', side: 'SELL' });
        }
      }
    } else if (cci <= down) {
      if (this.trend.direction !== 'oversold') {
        log('info', 'CCI: oversold trend detected');
        this.trend = { direction: 'oversold', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          createOrder({ type: 'STICKY', side: 'BUY' });
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          createOrder({ type: 'STICKY', side: 'BUY' });
        }
      }
    } else {
      if (this.trend.direction !== 'nodirection') {
        this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
      } else {
        this.trend.duration++;
      }
    }

    log('debug', `Trend: ${this.trend.direction} for ${this.trend.duration}`);
  }

  log({ log }: Tools<CCIStrategyParams>, ...indicators: unknown[]): void {
    const [cci] = indicators;
    if (!isNumber(cci)) return;
    log('debug', `CCI: ${cci.toFixed(2)}`);
  }
  // NOT USED
  onEachCandle(_tools: Tools<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_order: OrderCompleted): void {}
  onOrderCanceled(_order: OrderCanceled): void {}
  onOrderErrored(_order: OrderErrored): void {}
  end(): void {}
}
