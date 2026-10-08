import { Indicator } from '@indicators/indicator';
import { RSI } from '@indicators/oscillators/rsi/rsi.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { Stochastic } from '../stochastic/stochastic.indicator';

/**
 * TA-Lib's STOCHRSI: the Stochastic of the RSI over period. fastK is the raw %K of the last fastKPeriod RSI values, and fastD its
 * slowMaType average over fastDPeriod. The first result comes at candle period + fastKPeriod + lookback(fastD), the lookback being
 * fastDPeriod − 1, or 2 × (fastDPeriod − 1) for a dema: candle 21 by default, 23 with a dema.
 */
export class StochasticRSI extends Indicator<'StochasticRSI'> {
  private rsi: RSI;
  private stoch: Stochastic;

  constructor({ period = 14, fastKPeriod = 5, fastDPeriod = 3, slowMaType = 'sma' }: IndicatorRegistry['StochasticRSI']['input'] = {}) {
    super();
    this.rsi = new RSI({ period });
    this.stoch = new Stochastic({
      fastKPeriod,
      slowKPeriod: 1,
      slowKMaType: slowMaType,
      slowDPeriod: fastDPeriod,
      slowDMaType: slowMaType,
    });
  }

  public onNewCandle(candle: Candle): void {
    this.rsi.onNewCandle(candle);
    const rsiValue = this.rsi.getResult();
    if (isNil(rsiValue)) return;

    this.stoch.onNewCandle({ high: rsiValue, low: rsiValue, close: rsiValue } as Candle);
    const stoch = this.stoch.getResult();

    if (!isNil(stoch)) this.result = { fastK: stoch.k, fastD: stoch.d };
  }
}
