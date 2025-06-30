import { Indicator } from '@indicators/indicator';
import { RSI } from '@indicators/oscillators/rsi/rsi.indicator';
import { Candle } from '@models/types/candle.types';
import { isNil } from 'lodash-es';
import { Stochastic } from '../stochastic/stochastic.indicator';

export class StochasticRSI extends Indicator<'StochasticRSI'> {
  private rsi: RSI;
  private stoch: Stochastic;

  constructor({
    period = 14,
    fastKPeriod = 5,
    fastDPeriod = 3,
    slowMaType = 'sma',
  }: IndicatorRegistry['StochasticRSI']['input'] = {}) {
    super('StochasticRSI', { fastK: null, fastD: null });
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
    const { k: fastK, d: fastD } = this.stoch.getResult();

    if (!isNil(fastK) && !isNil(fastD)) this.result = { fastK, fastD };
  }

  public getResult() {
    return this.result;
  }
}
