import { TradeCompleted } from '@models/tradeStatus.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { pluralize } from '@utils/string/string.utils';
import { isNumber } from 'lodash-es';
import { RSICurrentTrend, RSIStrategyParams } from './rsi.types';

export class RSI implements Strategy<RSIStrategyParams> {
  private trend: RSICurrentTrend;

  constructor() {
    this.trend = { direction: 'none', duration: 0, adviced: false };
  }

  onCandleAfterWarmup({ strategyParams, advice, log }: Tools<RSIStrategyParams>, ...indicators: unknown[]): void {
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
        advice('short');
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
        advice('long');
      }
    }
  }

  init(addIndicator: AddIndicatorFn, strategyParams: RSIStrategyParams): void {
    const { period, src } = strategyParams;
    addIndicator('RSI', { period, src });
  }

  // NOT USED
  onTradeCompleted(_trade: TradeCompleted): void {}
  onEachCandle(_tools: Tools<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  log(_tools: Tools<RSIStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
