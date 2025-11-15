import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI implements Strategy<CCIStrategyParams> {
  private trend: CCITrend;

  constructor() {
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  init({ tools, addIndicator }: InitParams<CCIStrategyParams>): void {
    addIndicator('CCI', { period: tools.strategyParams.period });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: unknown[]): void {
    const { strategyParams, createOrder, log } = tools;
    const [cci] = indicators;
    if (!isNumber(cci)) return;

    const { up, down, persistence } = strategyParams.thresholds;

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

  log({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: unknown[]): void {
    const [cci] = indicators;
    if (!isNumber(cci)) return;
    tools.log('debug', `CCI: ${cci.toFixed(2)}`);
  }
  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
