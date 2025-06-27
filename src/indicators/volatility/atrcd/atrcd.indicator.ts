import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';
import { ATR } from '../atr/atr.indicator';

export class ATRCD extends Indicator<'ATRCD'> {
  private emaFast: ATR;
  private emaSlow: ATR;
  private emaSignal: EMA;
  private threshold: number;
  private age: number;

  constructor(
    { short = 12, long = 26, signal = 9 }: IndicatorRegistry['ATRCD']['input'] = {
      short: 12,
      long: 26,
      signal: 9,
    },
  ) {
    super('ATRCD', { atrcd: null, signal: null, hist: null });

    this.emaFast = new ATR({ period: short });
    this.emaSlow = new ATR({ period: long });
    this.emaSignal = new EMA({ period: signal });
    this.threshold = long - 1 - (short - 1);
    this.age = 0;
  }

  public onNewCandle(candle: Candle): void {
    this.emaSlow.onNewCandle(candle);

    if (this.age < this.threshold) {
      this.age++;
      return;
    }
    this.emaFast.onNewCandle(candle);

    const fast = this.emaFast.getResult();
    const slow = this.emaSlow.getResult();

    if (isNil(fast) || isNil(slow)) return;
    const atrcdLine = Big(fast).minus(slow);
    this.emaSignal.onNewCandle({ close: +atrcdLine } as Candle);
    const signalNum = this.emaSignal.getResult();

    if (isNil(signalNum)) return;
    const hist = atrcdLine.minus(Big(signalNum));

    this.result = {
      atrcd: +atrcdLine,
      signal: signalNum,
      hist: +hist,
    };
  }

  public getResult() {
    return this.result;
  }
}
