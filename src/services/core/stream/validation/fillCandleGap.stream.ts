import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleEvent } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { Transform, TransformCallback } from 'node:stream';

export class FillCandleGapStream extends Transform {
  private lastCandle: Record<TradingPair, Candle> = {};

  constructor() {
    super({ objectMode: true });
  }

  async _transform({ symbol, candle }: CandleEvent, _: BufferEncoding, next: TransformCallback) {
    try {
      const lastCandle = this.lastCandle[symbol];

      if (!lastCandle) {
        if (candle) {
          this.lastCandle[symbol] = candle;
          this.push({ symbol, candle });
        }
        return next();
      }

      if (!candle) {
        warning('stream', `Gap detected: missing candle(s) @ ${toISOString(lastCandle.start + ONE_MINUTE)}`);
        warning('stream', 'Filling gap using synthetic (empty) candles.');

        const filledCandle = createEmptyCandle(lastCandle);
        this.push({ symbol, candle: filledCandle });
        this.lastCandle[symbol] = filledCandle;
      } else {
        this.push({ symbol, candle });
        this.lastCandle[symbol] = candle;
      }

      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
