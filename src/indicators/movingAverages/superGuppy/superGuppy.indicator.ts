import { Candle } from '@models/types/candle.types';
import { isSorted } from '@utils/array/array.utils';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';
import { EMA } from '../ema/ema.indicator';

export class SuperGuppy extends Indicator<'SuperGuppy'> {
  private ema1: EMA;
  private ema2: EMA;
  private ema3: EMA;
  private ema4: EMA;
  private ema5: EMA;
  private ema6: EMA;
  private ema7: EMA;
  private ema8: EMA;
  private ema9: EMA;
  private ema10: EMA;
  private ema11: EMA;
  private ema12: EMA;
  private ema13: EMA;
  private ema14: EMA;
  private ema15: EMA;
  private ema16: EMA;
  private ema17: EMA;
  private ema18: EMA;
  private ema19: EMA;
  private ema20: EMA;
  private ema21: EMA;
  private ema22: EMA;

  constructor({
    period1 = 3,
    period2 = 6,
    period3 = 9,
    period4 = 12,
    period5 = 15,
    period6 = 18,
    period7 = 21,
    period8 = 24,
    period9 = 27,
    period10 = 30,
    period11 = 33,
    period12 = 36,
    period13 = 39,
    period14 = 42,
    period15 = 45,
    period16 = 48,
    period17 = 51,
    period18 = 54,
    period19 = 57,
    period20 = 60,
    period21 = 63,
    period22 = 66,
    src = 'close',
  }: IndicatorRegistry['SuperGuppy']['input'] = {}) {
    super('SuperGuppy', null);
    this.ema1 = new EMA({ period: period1, src });
    this.ema2 = new EMA({ period: period2, src });
    this.ema3 = new EMA({ period: period3, src });
    this.ema4 = new EMA({ period: period4, src });
    this.ema5 = new EMA({ period: period5, src });
    this.ema6 = new EMA({ period: period6, src });
    this.ema7 = new EMA({ period: period7, src });
    this.ema8 = new EMA({ period: period8, src });
    this.ema9 = new EMA({ period: period9, src });
    this.ema10 = new EMA({ period: period10, src });
    this.ema11 = new EMA({ period: period11, src });
    this.ema12 = new EMA({ period: period12, src });
    this.ema13 = new EMA({ period: period13, src });
    this.ema14 = new EMA({ period: period14, src });
    this.ema15 = new EMA({ period: period15, src });
    this.ema16 = new EMA({ period: period16, src });
    this.ema17 = new EMA({ period: period17, src });
    this.ema18 = new EMA({ period: period18, src });
    this.ema19 = new EMA({ period: period19, src });
    this.ema20 = new EMA({ period: period20, src });
    this.ema21 = new EMA({ period: period21, src });
    this.ema22 = new EMA({ period: period22, src });
  }

  public onNewCandle(candle: Candle) {
    this.ema1.onNewCandle(candle);
    this.ema2.onNewCandle(candle);
    this.ema3.onNewCandle(candle);
    this.ema4.onNewCandle(candle);
    this.ema5.onNewCandle(candle);
    this.ema6.onNewCandle(candle);
    this.ema7.onNewCandle(candle);
    this.ema8.onNewCandle(candle);
    this.ema9.onNewCandle(candle);
    this.ema10.onNewCandle(candle);
    this.ema11.onNewCandle(candle);
    this.ema12.onNewCandle(candle);
    this.ema13.onNewCandle(candle);
    this.ema14.onNewCandle(candle);
    this.ema15.onNewCandle(candle);
    this.ema16.onNewCandle(candle);
    this.ema17.onNewCandle(candle);
    this.ema18.onNewCandle(candle);
    this.ema19.onNewCandle(candle);
    this.ema20.onNewCandle(candle);
    this.ema21.onNewCandle(candle);
    this.ema22.onNewCandle(candle);

    const res1 = this.ema1.getResult();
    const res2 = this.ema2.getResult();
    const res3 = this.ema3.getResult();
    const res4 = this.ema4.getResult();
    const res5 = this.ema5.getResult();
    const res6 = this.ema6.getResult();
    const res7 = this.ema7.getResult();
    const res8 = this.ema8.getResult();
    const res9 = this.ema9.getResult();
    const res10 = this.ema10.getResult();
    const res11 = this.ema11.getResult();
    const res12 = this.ema12.getResult();
    const res13 = this.ema13.getResult();
    const res14 = this.ema14.getResult();
    const res15 = this.ema15.getResult();
    const res16 = this.ema16.getResult();
    const res17 = this.ema17.getResult();
    const res18 = this.ema18.getResult();
    const res19 = this.ema19.getResult();
    const res20 = this.ema20.getResult();
    const res21 = this.ema21.getResult();
    const res22 = this.ema22.getResult();

    if (
      isNil(res1) ||
      isNil(res2) ||
      isNil(res3) ||
      isNil(res4) ||
      isNil(res5) ||
      isNil(res6) ||
      isNil(res7) ||
      isNil(res8) ||
      isNil(res9) ||
      isNil(res10) ||
      isNil(res11) ||
      isNil(res12) ||
      isNil(res13) ||
      isNil(res14) ||
      isNil(res15) ||
      isNil(res16) ||
      isNil(res17) ||
      isNil(res18) ||
      isNil(res19) ||
      isNil(res20) ||
      isNil(res21) ||
      isNil(res22)
    )
      return;

    const results = [
      res1,
      res2,
      res3,
      res4,
      res5,
      res6,
      res7,
      res8,
      res9,
      res10,
      res11,
      res12,
      res13,
      res14,
      res15,
      res16,
      res17,
      res18,
      res19,
      res20,
      res21,
      res22,
    ];
    this.result = {
      results,
      spread: Math.max(...results) - Math.min(...results),
      fastRibbonBearish: isSorted(results.slice(0, 7), 'SAsc'),
      fastRibbonBullish: isSorted(results.slice(0, 7), 'SDesc'),
      slowRibbonBearish: isSorted(results.slice(7), 'SAsc'),
      slowRibbonBullish: isSorted(results.slice(7), 'SDesc'),
    };
  }

  public getResult() {
    return this.result;
  }
}
