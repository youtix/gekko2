import { BollingerBands } from '@indicators/volatility/bollingerBands/bollingerBands.indicator';
import { Candle } from '@models/types/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

export class OBV extends Indicator<'OBV'> {
  private prevClose?: number;
  private obv: number;
  private bb: BollingerBands;

  constructor({ period = 14, stdevUp = 2, stdevDown = 2, maType = 'sma' }: IndicatorRegistry['OBV']['input'] = {}) {
    super('OBV', { obv: null, ma: null, upper: null, lower: null });
    this.obv = 0;
    this.bb = new BollingerBands({ period, stdevDown, stdevUp, maType });
  }

  public onNewCandle(candle: Candle): void {
    if (isNil(this.prevClose)) {
      this.prevClose = candle.close;
      return;
    }

    if (candle.close > this.prevClose) this.obv += candle.volume;
    else if (candle.close < this.prevClose) this.obv -= candle.volume;

    this.bb.onNewCandle({ close: this.obv } as Candle);
    const { lower, middle, upper } = this.bb.getResult();

    this.prevClose = candle.close;
    this.result = {
      obv: this.obv,
      ma: middle,
      upper: upper,
      lower: lower,
    };
  }

  public getResult() {
    return this.result;
  }
}
