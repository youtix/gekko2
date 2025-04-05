import { Candle } from '@models/types/candle.types';
import { Configuration } from '@models/types/configuration.types';
import { config } from '@services/configuration/configuration';
import { logger } from '@services/logger';
import { fillMissingCandles } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { addMinutes } from 'date-fns';
import { bindAll, dropRight, each } from 'lodash-es';
import { Transform, TransformCallback } from 'node:stream';
import { FILL_GAPS_MODE } from './gapFiller.const';

export class GapFillerStream extends Transform {
  private lastCandle?: Candle;
  private fillGaps: Configuration['watch']['fillGaps'];
  // private broker: Broker;

  constructor() {
    super({ objectMode: true });
    const { fillGaps, mode } = config.getWatch();
    // this.broker = inject.secondaryBroker();
    this.fillGaps = FILL_GAPS_MODE[mode as string] ?? fillGaps;
    bindAll(this, ['pushCandle']);
  }

  async _transform(candle: Candle, encoding: BufferEncoding, next: TransformCallback) {
    try {
      if (this.lastCandle) {
        const expectedTimestamp = addMinutes(this.lastCandle.start, 1).getTime();
        const hasMissingCandle = expectedTimestamp !== candle.start;

        if (hasMissingCandle) {
          logger.warn(
            [
              `Gap detected: missing candle(s) between ${toISOString(this.lastCandle.start)}`,
              `and ${toISOString(candle.start)}.`,
            ].join(' '),
          );
          if (this.fillGaps === 'empty') this.fillWithEmptyCandles(this.lastCandle, candle);
          // if (this.fillGaps === 'broker') await this.fillWithBrokerCandles(this.lastCandle, candle);
        }
      }
      this.pushCandle(candle);
      this.lastCandle = candle;
      next();
    } catch (error) {
      next(error as Error);
    }
  }

  _flush(callback: TransformCallback) {
    // Finalize any remaining work if necessary.
    callback();
  }

  fillWithEmptyCandles(before: Candle, after: Candle) {
    logger.warn('Filling gap using synthetic (empty) candles.');
    const [, ...emptyCandles] = fillMissingCandles([before, after]) ?? [];
    each(dropRight(emptyCandles), this.pushCandle);
  }

  // async fillWithBrokerCandles(before: Candle, after: Candle) {
  //   logger.warn(`Filling gap using broker data from ${this.broker.getBrokerName()}.`);
  //   const from = addMinutes(before.start, 1).getTime();
  //   const fetchedCandles = await this.broker.fetchOHLCV(from);
  //   const candles = bridgeCandleGap(fetchedCandles, before, after);
  //   if (!candles.length) {
  //     logger.warn(
  //       'No valid candles returned by broker for the missing gap. Falling back to synthetic (empty) candles.',
  //     );
  //     this.fillWithEmptyCandles(before, after);
  //   } else {
  //     candles.forEach(this.pushCandle);
  //   }
  // }

  pushCandle(candle: Candle) {
    this.push(candle);
  }
}
