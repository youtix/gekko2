import { debug, info } from '@services/logger';
import { Strategy } from '@strategies/strategy';
import { isNumber } from 'lodash-es';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI extends Strategy<CCIStrategyParams> {
  private trend: CCITrend;

  constructor(strategyName: string, candleSize: number, requiredHistory?: number) {
    super(strategyName, candleSize, requiredHistory);
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  protected init(): void {
    this.addIndicator('CCI', { period: this.strategySettings.period });
  }

  protected onCandleAfterWarmup(): void {
    const [cci] = this.indicators;
    const cciVal = cci.getResult();
    if (!isNumber(cciVal)) return;

    const { up, down, persistence } = this.strategySettings.thresholds;

    if (cciVal >= up) {
      if (this.trend.direction !== 'overbought') {
        info('strategy', 'CCI: overbought trend detected');
        this.trend = { direction: 'overbought', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          this.advice('short');
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          this.advice('short');
        }
      }
    } else if (cciVal <= down) {
      if (this.trend.direction !== 'oversold') {
        info('strategy', 'CCI: oversold trend detected');
        this.trend = { direction: 'oversold', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          this.advice('long');
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          this.advice('long');
        }
      }
    } else {
      if (this.trend.direction !== 'nodirection') {
        this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
      } else {
        this.trend.duration++;
      }
    }

    debug('strategy', `Trend: ${this.trend.direction} for ${this.trend.duration}`);
  }

  // NOT USED
  protected log(): void {
    const [cci] = this.indicators;
    const cciVal = cci.getResult();
    if (!isNumber(cciVal)) return;
    debug('strategy', `CCI: ${cciVal.toFixed(2)}`);
  }
  protected onEachCandle(): void {}
  protected onTradeExecuted(): void {}
  protected end(): void {}
}
