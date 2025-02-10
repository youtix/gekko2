import Big from 'big.js';
import { compact, drop, first, max, min, omit, reduce } from 'lodash-es';
import { Candle } from '../../../../models/types/candle.types';

export class CandleBatcher {
  smallCandles: Candle[];
  candleSize: number;
  constructor(candleSize: number) {
    this.smallCandles = [];
    this.candleSize = candleSize;
  }

  public addSmallCandle(candle: Candle) {
    this.smallCandles = [...this.smallCandles, candle];

    if (this.smallCandles.length % this.candleSize === 0) {
      const newCandle = this.createBigCandleFrom(this.smallCandles);
      this.smallCandles = [];
      return newCandle;
    }
  }

  public addSmallCandles(candles: Candle[]) {
    return reduce(
      candles,
      (candleBucket, currentCandle) => {
        return compact([...candleBucket, this.addSmallCandle(currentCandle)]);
      },
      [] as Candle[],
    );
  }

  private createBigCandleFrom(smallCandles: Candle[]): Candle {
    const firstCandle = omit(first(smallCandles), 'id');

    const candle = reduce(
      drop(smallCandles),
      (prevCandle, currentCandle) => ({
        ...prevCandle,
        start: firstCandle.start,
        high: max([prevCandle.high, currentCandle.high]) ?? 0,
        low: min([prevCandle.low, currentCandle.low]) ?? 0,
        close: currentCandle.close,
        volume: +Big(currentCandle.volume).plus(prevCandle.volume),
      }),
      firstCandle,
    );

    return candle;
  }
}
