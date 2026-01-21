import { Candle } from '@models/candle.types';
import { Configuration } from '@models/configuration.types';
import { CandleEvent } from '@models/event.types';
import { Symbol } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import { fillMissingCandles } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { differenceInMinutes } from 'date-fns';
import { bindAll, dropRight } from 'lodash-es';
import { Transform, TransformCallback } from 'node:stream';
import { FILL_GAPS_MODE } from './candleValidator.const';

const ONE_MINUTE_MS = 60_000;

/**
 * A Transform stream that validates and normalizes the candle sequence.
 *
 * This stream performs the following validations:
 * - **Future candle rejection**: Rejects candles whose end time (start + 1 minute) is in the future.
 * - **Duplicate detection**: Ignores candles that have already been processed (same or earlier timestamp).
 * - **Gap detection**: Detects missing candles in the sequence and optionally fills them with synthetic empty candles.
 */
export class CandleValidatorStream extends Transform {
  private lastCandle?: Candle; // TODO: support multiple pairs
  private fillGaps: Configuration['watch']['fillGaps'];

  constructor() {
    super({ objectMode: true });
    const { fillGaps, mode } = config.getWatch();
    this.fillGaps = FILL_GAPS_MODE[mode as string] ?? fillGaps;
    bindAll(this, ['pushCandle']);
  }

  async _transform({ symbol, candle }: CandleEvent, _: BufferEncoding, next: TransformCallback) {
    try {
      const candleEndTime = candle.start + ONE_MINUTE_MS;
      if (candleEndTime > Date.now()) {
        warning(
          'stream',
          `Rejecting future candle: candle end time ${toISOString(candleEndTime)} is in the future. Current time: ${toISOString(Date.now())}.`,
        );
        return next();
      }

      const gapBetweenCandle = this.lastCandle ? differenceInMinutes(candle.start, this.lastCandle.start) : 1;
      const hasMissingCandle = gapBetweenCandle > 1;
      const isCandleAlreadyProceed = gapBetweenCandle < 1;

      if (hasMissingCandle) {
        warning(
          'stream',
          [
            `Gap detected: missing candle(s) between ${toISOString(this.lastCandle?.start)}`,
            `and ${toISOString(candle.start)}.`,
          ].join(' '),
        );
        if (this.fillGaps === 'empty' && this.lastCandle) this.fillWithEmptyCandles(this.lastCandle, candle, symbol);
      }
      if (isCandleAlreadyProceed) {
        warning(
          'stream',
          [
            'Gap detected: candle already proceed ! Ignoring it !',
            `Current candle being proceed: ${toISOString(candle.start)}`,
            `Last candle proceed ${toISOString(this.lastCandle?.start)}.`,
          ].join(' '),
        );
      } else {
        this.pushCandle(symbol, candle);
        this.lastCandle = candle;
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  }

  fillWithEmptyCandles(before: Candle, after: Candle, symbol: Symbol) {
    warning('stream', 'Filling gap using synthetic (empty) candles.');
    const [, ...emptyCandles] = fillMissingCandles([before, after]) ?? [];
    dropRight(emptyCandles).forEach(candle => this.pushCandle(symbol, candle));
  }

  pushCandle(symbol: Symbol, candle: Candle) {
    this.push({ symbol, candle });
  }
}
