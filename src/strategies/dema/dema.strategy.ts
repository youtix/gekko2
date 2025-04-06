import { Candle } from '@models/types/candle.types';
import { debug, info } from '@services/logger';
import { Strategy } from '@strategies/strategy';

export class DEMA extends Strategy<'DEMA'> {
  private currentTrend?: 'down' | 'up';

  protected init(): void {
    this.addIndicator('DEMA', { period: this.strategySettings.period });
    this.addIndicator('SMA', { period: this.strategySettings.period });
  }

  protected onCandleAfterWarmup(candle: Candle): void {
    const [dema, sma] = this.indicators;
    const resDEMA = dema.getResult();
    const resSMA = sma.getResult();
    const price = candle.close;
    if (!resSMA || !resDEMA) return;

    const diff = resSMA - resDEMA;

    const message = '@ ' + price.toFixed(8) + ' (' + resDEMA.toFixed(5) + '/' + diff.toFixed(5) + ')';

    if (diff > this.strategySettings.thresholds.up) {
      debug('strategy', `We are currently in uptrend: ${message}`);

      if (this.currentTrend !== 'up') {
        this.currentTrend = 'up';
        info('strategy', `Executing long advice due to detected uptrend: ${message}`);
        this.advice('long');
      }
    } else if (diff < this.strategySettings.thresholds.down) {
      debug('strategy', `We are currently in a downtrend: ${message}`);

      if (this.currentTrend !== 'down') {
        this.currentTrend = 'down';
        info('strategy', `Executing short advice due to detected downtrend: ${message}`);
        this.advice('short');
      }
    } else {
      debug('strategy', `We are currently not in an up or down trend: ${message}`);
    }
  }

  protected log(): void {
    const [dema, sma] = this.indicators;

    debug(
      'strategy',
      [
        'Calculated DEMA and SMA properties for candle:',
        `DEMA: ${dema.getResult()?.toFixed(5)}`,
        `SMA: ${sma.getResult()?.toFixed(5)}`,
      ].join(' '),
    );
  }

  // NOT USED
  protected onTradeExecuted(): void {}
  protected onEachCandle(): void {}
  protected end(): void {}
}
