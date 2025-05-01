import { debug, info } from '@services/logger';
import { Strategy } from '@strategies/strategy';
import { isNumber } from 'lodash-es';

export class TMA extends Strategy<'TMA'> {
  constructor(strategyName: string, candleSize: number, requiredHistory?: number) {
    super(strategyName, candleSize, requiredHistory);
  }

  protected init(): void {
    this.addIndicator('SMA', { period: this.strategySettings.short });
    this.addIndicator('SMA', { period: this.strategySettings.medium });
    this.addIndicator('SMA', { period: this.strategySettings.long });
  }

  protected onCandleAfterWarmup(): void {
    const [shortSMA, mediumSMA, longSMA] = this.indicators;
    const short = shortSMA.getResult();
    const medium = mediumSMA.getResult();
    const long = longSMA.getResult();
    if (!isNumber(short) || !isNumber(medium) || !isNumber(long)) return;

    if (short > medium && medium > long) {
      info('strategy', `Executing long advice due to detected uptrend: ${short}/${medium}/${long}`);
      this.advice('long');
    } else if (short < medium && medium > long) {
      info('strategy', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      this.advice('short');
    } else if (short > medium && medium < long) {
      info('strategy', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      this.advice('short');
    } else {
      debug('strategy', `No clear trend detected: ${short}/${medium}/${long}`);
    }
  }

  // NOT USED
  protected onEachCandle(/* candle: Candle */): void {}
  protected log(): void {}
  protected onTradeExecuted(): void {}
  protected end(): void {}
}
