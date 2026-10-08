import { checkBelow, checkInteger } from '@indicators/indicator.utils';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';
import { ATR } from '../atr/atr.indicator';

export class ATRCD extends Indicator<'ATRCD'> {
  private emaFast: ATR;
  private emaSlow: ATR;
  private emaSignal: EMA;
  private threshold: number;
  private age: number;

  /**
   * @param short - Period of the fast ATR: a whole number, at least 1, below long. Default 12
   * @param long - Period of the slow ATR: a whole number above short. Default 26
   * @param signal - Period of the signal line, the EMA of the ATRCD: a whole number, at least 1. Default 9
   */
  constructor({ short = 12, long = 26, signal = 9 }: IndicatorRegistry['ATRCD']['input'] = {}) {
    super();
    checkInteger('ATRCD', 'short', short);
    checkInteger('ATRCD', 'long', long);
    checkInteger('ATRCD', 'signal', signal);
    checkBelow('ATRCD', 'short', short, 'long', long, 'swapped periods give the opposite ATRCD, equal ones an ATRCD of 0');

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
    const atrcdLine = fast - slow;
    this.emaSignal.onNewCandle({ close: atrcdLine } as Candle);
    const signalNum = this.emaSignal.getResult();

    if (isNil(signalNum)) return;
    const hist = atrcdLine - signalNum;

    this.result = {
      atrcd: atrcdLine,
      signal: signalNum,
      hist,
    };
  }
}
