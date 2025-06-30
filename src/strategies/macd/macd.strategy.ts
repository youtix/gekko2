import { debug, info } from '@services/logger';
import { Strategy } from '@strategies/strategy';
import { isNil, isObject } from 'lodash-es';
import { MACDTrend } from './macd.types';

export class MACD extends Strategy<'MACD'> {
  private trend?: MACDTrend;

  constructor(strategyName: string, candleSize: number, requiredHistory?: number) {
    super(strategyName, candleSize, requiredHistory);
  }

  protected init(): void {
    this.addIndicator('MACD', {
      short: this.strategySettings.short,
      long: this.strategySettings.long,
      signal: this.strategySettings.signal,
    });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  protected onCandleAfterWarmup(): void {
    const { macdSrc } = this.strategySettings;
    const [macd] = this.indicators;
    const macdResult = macd.getResult() as IndicatorRegistry['MACD']['output'];
    if (isNil(macdResult?.[macdSrc])) return;

    if (macdResult[macdSrc] > this.strategySettings.thresholds.up) {
      if (this.trend?.direction !== 'up') {
        info('strategy', 'MACD: up trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'up', adviced: false };
      }
      this.trend.duration++;
      debug('strategy', `In uptrend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= this.strategySettings.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('long');
      }
    } else if (macdResult[macdSrc] < this.strategySettings.thresholds.down) {
      if (this.trend?.direction !== 'down') {
        info('strategy', 'MACD: down trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'down', adviced: false };
      }
      this.trend.duration++;
      debug('strategy', `In downtrend since ${this.trend.duration} candle(s)`);

      if (this.trend.duration >= this.strategySettings.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('short');
      }
    } else {
      debug('strategy', 'MACD: no trend detected');
    }
  }

  protected log(): void {
    const [macd] = this.indicators;
    const macdResult = macd.getResult();
    if (!isObject(macdResult) || !('macd' in macdResult) || isNil(macdResult.macd)) return;

    debug('strategy', `macd: ${macdResult.macd.toFixed(8)}`);
    debug('strategy', `signal: ${macdResult.signal?.toFixed(8)}`);
    debug('strategy', `hist: ${macdResult.hist?.toFixed(8)}`);
  }

  // NOT USED
  protected onEachCandle(/* candle: Candle */): void {}
  protected onTradeExecuted(): void {}
  protected end(): void {}
}
