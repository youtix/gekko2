import { TradeCompleted } from '@models/types/tradeStatus.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI implements Strategy<CCIStrategyParams> {
  private trend: CCITrend;

  constructor() {
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  init(addIndicator: AddIndicatorFn, strategySettings: CCIStrategyParams): void {
    addIndicator('CCI', { period: strategySettings.period });
  }

  onCandleAfterWarmup(
    { advice, strategyParams: strategySettings, info, debug }: Tools<CCIStrategyParams>,
    ...indicators: unknown[]
  ): void {
    const [cci] = indicators;
    if (!isNumber(cci)) return;

    const { up, down, persistence } = strategySettings.thresholds;

    if (cci >= up) {
      if (this.trend.direction !== 'overbought') {
        info('strategy', 'CCI: overbought trend detected');
        this.trend = { direction: 'overbought', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          advice('short');
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          advice('short');
        }
      }
    } else if (cci <= down) {
      if (this.trend.direction !== 'oversold') {
        info('strategy', 'CCI: oversold trend detected');
        this.trend = { direction: 'oversold', duration: 1, persisted: persistence === 0, adviced: false };
        if (persistence === 0) {
          this.trend.adviced = true;
          advice('long');
        }
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
        if (this.trend.persisted && !this.trend.adviced) {
          this.trend.adviced = true;
          advice('long');
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

  log({ debug }: Tools<CCIStrategyParams>, ...indicators: unknown[]): void {
    const [cci] = indicators;
    if (!isNumber(cci)) return;
    debug('strategy', `CCI: ${cci.toFixed(2)}`);
  }
  // NOT USED
  onEachCandle(_tools: Tools<CCIStrategyParams>, ..._indicators: unknown[]): void {}
  onTradeCompleted(_trade: TradeCompleted): void {}
  end(): void {}
}
