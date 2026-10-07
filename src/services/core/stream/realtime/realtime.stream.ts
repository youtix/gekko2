import { ONE_MINUTE } from '@constants/time.const';
import { TradingPair } from '@models/utility.types';
import { Heart } from '@services/core/heart/heart';
import { Exchange } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { debug, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { startOfMinute } from 'date-fns';
import { first } from 'lodash-es';
import { Readable } from 'node:stream';

/**
 * The live 1-minute candles of one pair: every minute from `startMinute` on, in order, each fetched once it has closed.
 *
 * The stream counts the minutes itself. Taking at each tick the minute before the one in progress would make the minute depend on when
 * the tick runs: the ticks fall on the minute boundaries, each pair's stream ticks on its own, and a busy event loop delays them. A tick
 * landing past the next boundary would skip a minute, one firing before it would fetch a minute twice, and two pairs ticking on either
 * side of a boundary would fetch different minutes. Their candles would then reach separate buckets, each lacking a pair, which the gap
 * filler can only make up from an earlier candle of that pair: never in the first bucket. Started on the same minute, the streams of
 * all the pairs fetch the same minutes, whenever they tick.
 */
export class RealtimeStream extends Readable {
  protected heart: Heart;
  private readonly exchange: Exchange;
  private readonly symbol: TradingPair;
  private readonly startTimeout: Timer;
  /** The next minute to fetch */
  private nextMinute: EpochTimeStamp;
  /** Set while the closed minutes are fetched: a tick meanwhile leaves them to that loop, so that they are pushed in order */
  private isFetching = false;

  constructor(symbol: TradingPair, startMinute: EpochTimeStamp) {
    super({ objectMode: true });
    this.exchange = inject.exchange();
    this.symbol = symbol;
    this.nextMinute = startMinute;
    this.heart = new Heart(ONE_MINUTE);

    this.heart.on('tick', () => this.onTick());

    const delay = ONE_MINUTE - (Date.now() % ONE_MINUTE);
    this.startTimeout = setTimeout(() => this.heart.pump(), delay);
  }

  /** Fetches, oldest first, every minute closed since the last one fetched: none on a tick that fires early, all the missed ones late */
  private async onTick() {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      while (!this.destroyed && this.nextMinute < startOfMinute(Date.now()).getTime()) {
        const minute = this.nextMinute;
        // Moved past before the request: a minute whose fetch fails or brings no candle is not fetched again, the gap filler fills it
        this.nextMinute = minute + ONE_MINUTE;
        await this.fetchCandle(minute);
      }
    } finally {
      this.isFetching = false;
    }
  }

  private async fetchCandle(minute: EpochTimeStamp) {
    const candles = await this.exchange.fetchOHLCV(this.symbol, { from: minute, limit: 1 });
    const candle = first(candles);
    if (candle) {
      debug(
        'stream',
        [
          `1m candle from ${this.exchange.getExchangeName()} for ${this.symbol} @ ${toISOString(candle.start)} `,
          `O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`,
        ].join(' '),
      );
      this.push({ symbol: this.symbol, candle });
    } else warning('stream', 'Received undefined candle');
  }

  _read(): void {
    // Data is pushed from the exchange callback
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      clearTimeout(this.startTimeout);
      this.heart.stop();
    } finally {
      callback(error);
    }
  }
}
