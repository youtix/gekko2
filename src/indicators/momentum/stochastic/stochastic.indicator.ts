import { Indicator } from '@indicators/indicator';
import { MovingAverageClasses } from '@indicators/indicator.types';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/candle.types';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

export class Stochastic extends Indicator<'Stochastic'> {
  private highs: number[] = [];
  private lows: number[] = [];
  private closes: number[] = [];
  private idxFast = 0;
  private age: number;
  private warmingUpPeriod: number;

  private maSlowK: MovingAverageClasses;
  private maSlowD: MovingAverageClasses;

  constructor({
    fastKPeriod = 5,
    slowKPeriod = 3,
    slowKMaType = 'sma',
    slowDPeriod = 3,
    slowDMaType = 'sma',
  }: IndicatorRegistry['Stochastic']['input'] = {}) {
    super('Stochastic', { k: null, d: null });

    // buffers for raw Fast %K calculation
    this.highs = [];
    this.lows = [];
    this.closes = [];
    this.idxFast = 0;
    this.age = 0;
    this.warmingUpPeriod = fastKPeriod - 1 + slowKPeriod - 1 + slowDPeriod - 1;

    // smoothing engines
    this.maSlowK = new MOVING_AVERAGES[slowKMaType]({ period: slowKPeriod });
    this.maSlowD = new MOVING_AVERAGES[slowDMaType]({ period: slowDPeriod });

    // store periods on the instance for use below
    this.fastKPeriod = fastKPeriod;
  }

  private fastKPeriod: number;

  public onNewCandle(candle: Candle) {
    this.highs[this.idxFast] = candle.high;
    this.lows[this.idxFast] = candle.low;
    this.closes[this.idxFast] = candle.close;
    this.idxFast = (this.idxFast + 1) % this.fastKPeriod;

    const lowest = Math.min(...this.lows);
    const highest = Math.max(...this.highs);
    const range = highest - lowest;
    const rawK = range === 0 ? 0 : ((candle.close - lowest) / range) * 100;

    this.maSlowK.onNewCandle({ close: rawK } as Candle);
    const slowK = this.maSlowK.getResult();

    this.maSlowD.onNewCandle({ close: slowK ?? 0 } as Candle);
    const slowD = this.maSlowD.getResult();

    // Wait the end of warming up period
    if (this.warmingUpPeriod === this.age) this.result = { k: slowK, d: slowD };
    else this.age++;
  }

  public getResult() {
    return this.result;
  }
}
