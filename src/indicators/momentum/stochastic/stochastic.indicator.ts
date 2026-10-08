import { Indicator } from '@indicators/indicator';
import { MOVING_AVERAGE_TYPES } from '@indicators/indicator.const';
import { MovingAverageClasses } from '@indicators/indicator.types';
import { checkInteger, checkOneOf } from '@indicators/indicator.utils';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

/**
 * TA-Lib's STOCH. The raw %K places the close in the range of the last fastKPeriod candles: 0 at the lowest low, 100 at the highest
 * high, 0 when the range is flat. k is its slowKMaType average over slowKPeriod, and d the slowDMaType average of k over slowDPeriod.
 * The first result comes at candle fastKPeriod + lookback(k) + lookback(d), where an average's lookback is period − 1, or
 * 2 × (period − 1) for a dema: candle 9 by default, 13 when both averages are 3-candle demas. A dema overshoots its input, so a k or
 * a d smoothed by one can leave [0, 100], as in TA-Lib.
 */
export class Stochastic extends Indicator<'Stochastic'> {
  private fastKPeriod: number;
  private highs: number[] = [];
  private lows: number[] = [];
  private idxFast = 0;
  private maSlowK: MovingAverageClasses;
  private maSlowD: MovingAverageClasses;

  /**
   * @param fastKPeriod - Candles of the range the raw %K places the close in: a whole number, at least 1. Default 5
   * @param slowKPeriod - Period of the average of the raw %K that makes k: a whole number, at least 1. Default 3
   * @param slowKMaType - Kind of that average: sma, ema, dema or wma. Default sma
   * @param slowDPeriod - Period of the average of k that makes d: a whole number, at least 1. Default 3
   * @param slowDMaType - Kind of that average: sma, ema, dema or wma. Default sma
   */
  constructor({
    fastKPeriod = 5,
    slowKPeriod = 3,
    slowKMaType = 'sma',
    slowDPeriod = 3,
    slowDMaType = 'sma',
  }: IndicatorRegistry['Stochastic']['input'] = {}) {
    super();
    checkInteger('Stochastic', 'fastKPeriod', fastKPeriod);
    checkInteger('Stochastic', 'slowKPeriod', slowKPeriod);
    checkOneOf('Stochastic', 'slowKMaType', slowKMaType, MOVING_AVERAGE_TYPES);
    checkInteger('Stochastic', 'slowDPeriod', slowDPeriod);
    checkOneOf('Stochastic', 'slowDMaType', slowDMaType, MOVING_AVERAGE_TYPES);
    this.fastKPeriod = fastKPeriod;
    this.maSlowK = new MOVING_AVERAGES[slowKMaType]({ period: slowKPeriod });
    this.maSlowD = new MOVING_AVERAGES[slowDMaType]({ period: slowDPeriod });
  }

  public onNewCandle(candle: Candle) {
    this.highs[this.idxFast] = candle.high;
    this.lows[this.idxFast] = candle.low;
    this.idxFast = (this.idxFast + 1) % this.fastKPeriod;
    // The raw %K used to be taken over the partial windows of the first candles, and d fed 0 while k was not ready: an ema or a dema
    // seeded on those values carried their error for many candles, and a warm-up count that assumed period − 1 lookbacks published
    // a dema-smoothed result too early. Each average now only gets real values, and the result waits for d.
    if (this.highs.length < this.fastKPeriod) return;

    const lowest = Math.min(...this.lows);
    const highest = Math.max(...this.highs);
    const range = highest - lowest;
    const rawK = range === 0 ? 0 : ((candle.close - lowest) / range) * 100;

    this.maSlowK.onNewCandle({ close: rawK } as Candle);
    const slowK = this.maSlowK.getResult();
    if (isNil(slowK)) return;

    this.maSlowD.onNewCandle({ close: slowK } as Candle);
    const slowD = this.maSlowD.getResult();
    if (!isNil(slowD)) this.result = { k: slowK, d: slowD };
  }
}
