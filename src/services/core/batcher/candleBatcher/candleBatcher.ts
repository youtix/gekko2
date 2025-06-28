import { omit } from 'lodash-es';
import { Candle } from '../../../../models/types/candle.types';
import { CandleSize } from './candleBatcher.types';

export class CandleBatcher {
  smallCandles: Candle[];
  candleSize: CandleSize;

  constructor(candleSize: CandleSize) {
    this.smallCandles = [];
    this.candleSize = candleSize;
  }

  public addSmallCandle(candle: Candle): Candle | undefined {
    this.smallCandles.push(candle);
    if (this.isBigCandleReady(candle)) {
      const newCandle = this.createBigCandleFrom(this.smallCandles);
      this.smallCandles.length = 0;
      return newCandle;
    }
  }

  private createBigCandleFrom(smallCandles: Candle[]): Candle {
    const [firstCandle, ...rest] = smallCandles;
    const base = { ...omit(firstCandle, 'id') };

    return rest.reduce<Candle>(
      (acc, curr) => ({
        ...acc,
        start: base.start,
        high: Math.max(acc.high, curr.high),
        low: Math.min(acc.low, curr.low),
        close: curr.close,
        volume: acc.volume + curr.volume,
      }),
      base,
    );
  }

  private isBigCandleReady(currentCandle: Candle) {
    const date = new Date(currentCandle.start);
    const size = this.candleSize;
    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const day = date.getUTCDate();
    const month = date.getUTCMonth(); // 0 (january) - 11 (december)
    const weekday = date.getUTCDay(); // 0 (sunday) - 6 (saturday)

    if (size < 60) return minute % size === size - 1;
    if (size < 1440) {
      const hours = size / 60;
      return minute === 59 && hour % hours === hours - 1;
    }
    if (size < 10080) return hour === 23 && minute === 59;
    if (size === 10080) return weekday === 0 && hour === 23 && minute === 59;
    if (size === 43200) return this.isMonthEnd(date);
    if (size === 129600) return (month + 1) % 3 === 0 && this.isMonthEnd(date);
    if (size === 259200) return [5, 11].includes(month) && this.isMonthEnd(date);
    if (size === 518400) return month === 11 && day === 31 && hour === 23 && minute === 59;
    return false;
  }

  private isMonthEnd(date: Date): boolean {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return date.getUTCDate() === lastDay && date.getUTCHours() === 23 && date.getUTCMinutes() === 59;
  }
}
