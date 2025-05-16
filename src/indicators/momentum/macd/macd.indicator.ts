import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

export class MACD extends Indicator<'MACD'> {
  private emaFast: EMA;
  private emaSlow: EMA;
  private emaSignal: EMA;
  private threshold: number;
  private age: number;

  constructor(
    { short = 12, long = 26, signal = 9, src = 'close' }: IndicatorRegistry['MACD']['input'] = {
      short: 12,
      long: 26,
      signal: 9,
      src: 'close',
    },
  ) {
    super('MACD', { macd: null, signal: null, hist: null });

    this.emaFast = new EMA({ period: short, src });
    this.emaSlow = new EMA({ period: long, src });
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
    const macdLine = Big(fast).minus(slow);
    this.emaSignal.onNewCandle({ close: +macdLine } as Candle);
    const signalNum = this.emaSignal.getResult();

    if (isNil(signalNum)) return;
    const hist = macdLine.minus(Big(signalNum));

    this.result = {
      macd: +macdLine,
      signal: signalNum,
      hist: +hist,
    };
  }

  public getResult() {
    return this.result;
  }
}
