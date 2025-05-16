import { MinusDM } from '@indicators/directionalMovement/minusDM/minusDM.indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class PSAR extends Indicator<'PSAR'> {
  private acceleration: number;
  private maxAcceleration: number;
  private minusDM: MinusDM;
  private prevCandle?: Candle;
  private sar: number;
  private af: number;
  private ep: number;
  private isLong: boolean;

  constructor({ acceleration = 0.02, maxAcceleration = 0.2 }: IndicatorRegistry['PSAR']['input'] = {}) {
    super('PSAR', null);
    this.acceleration = acceleration;
    this.maxAcceleration = maxAcceleration;
    this.minusDM = new MinusDM({ period: 1 });
    this.af = this.acceleration;
    this.sar = NaN;
    this.ep = NaN;
    this.isLong = true;
  }

  private calcSar(sar: number, ep: number, af: number) {
    return +Big(ep).minus(sar).mul(af).plus(sar);
  }

  public onNewCandle(candle: Candle) {
    if (!this.prevCandle) {
      this.prevCandle = candle;
      return this.minusDM.onNewCandle(candle);
    }

    if (isNaN(this.sar)) {
      this.minusDM.onNewCandle(candle);
      const { high: prevHigh, low: prevLow } = this.prevCandle;
      this.isLong = (this.minusDM.getResult() ?? 0) <= 0;
      this.sar = this.isLong ? prevLow : prevHigh;
      this.ep = this.isLong ? candle.high : candle.low;
      this.prevCandle = candle;
    }

    const { high: prevHigh, low: prevLow } = this.prevCandle;
    const { high: currentHigh, low: currentLow } = candle;
    const newSar = this.sar;

    if (this.isLong) {
      if (currentLow <= this.sar) {
        // Switch to short
        this.isLong = false;
        this.result = Math.max(this.ep, prevHigh, currentHigh);
        this.af = this.acceleration;
        this.ep = currentLow;
        this.sar = Math.max(this.calcSar(this.result, this.ep, this.af), prevHigh, currentHigh);
      } else {
        this.result = this.sar;
        if (currentHigh > this.ep) {
          this.ep = currentHigh;
          this.af = Math.min(+Big(this.af).plus(this.acceleration), this.maxAcceleration);
        }
        this.sar = Math.min(this.calcSar(newSar, this.ep, this.af), prevLow, currentLow);
      }
    } else {
      if (currentHigh >= this.sar) {
        // Switch to long
        this.isLong = true;
        this.result = Math.min(this.ep, prevLow, currentLow);
        this.af = this.acceleration;
        this.ep = currentHigh;
        this.sar = Math.min(this.calcSar(this.result, this.ep, this.af), prevLow, currentLow);
      } else {
        this.result = this.sar;
        if (currentLow < this.ep) {
          this.ep = currentLow;
          this.af = Math.min(+Big(this.af).plus(this.acceleration), this.maxAcceleration);
        }
        this.sar = Math.max(this.calcSar(newSar, this.ep, this.af), prevHigh, currentHigh);
      }
    }
    this.prevCandle = candle;
  }

  public getResult() {
    return this.result;
  }
}
