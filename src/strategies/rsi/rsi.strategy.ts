import { debug, info } from '@services/logger';
import { Strategy } from '@strategies/strategy';
import { isNumber } from 'lodash-es';
import { RSICurrentTrend, RSIStrategyParams } from './rsi.types';

export class RSI extends Strategy<RSIStrategyParams> {
  private trend: RSICurrentTrend;

  constructor(strategyName: string, candleSize: number, requiredHistory?: number) {
    super(strategyName, candleSize, requiredHistory);
    this.trend = { direction: 'none', duration: 0, adviced: false };
  }

  protected init(): void {
    const { period, src } = this.strategySettings;
    this.addIndicator('RSI', { period, src });
  }

  protected onCandleAfterWarmup(): void {
    const [rsi] = this.indicators;
    const rsiVal = rsi.getResult();
    if (!isNumber(rsiVal)) return;
    const { thresholds } = this.strategySettings;

    if (rsiVal > thresholds.high) {
      if (this.trend.direction !== 'high') {
        info('strategy', 'RSI: high trend detected');
        this.trend = { duration: 0, direction: 'high', adviced: false };
      }
      this.trend.duration++;
      debug('strategy', `In high trend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('short');
      }
    } else if (rsiVal < thresholds.low) {
      if (this.trend.direction !== 'low') {
        info('strategy', 'RSI: low trend detected');
        this.trend = { duration: 0, direction: 'low', adviced: false };
      }
      this.trend.duration++;
      debug('strategy', `In low trend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('long');
      }
    }
  }

  // NOT USED
  protected log(): void {}
  protected onEachCandle(): void {}
  protected onTradeExecuted(): void {}
  protected end(): void {}
}
