import { ONE_MINUTE } from '@constants/time.const';
import { TradingPair } from '@models/utility.types';
import { Heart } from '@services/core/heart/heart';
import { Exchange } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { debug, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { startOfMinute, subMinutes } from 'date-fns';
import { first } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeStream extends Readable {
  protected heart: Heart;
  private readonly exchange: Exchange;

  constructor(symbol: TradingPair) {
    super({ objectMode: true });
    this.exchange = inject.exchange();
    this.heart = new Heart(ONE_MINUTE);

    this.heart.on('tick', () => this.onNewCandle(symbol));

    const delay = ONE_MINUTE - (Date.now() % ONE_MINUTE);
    setTimeout(() => this.heart.pump(), delay);
  }

  private async onNewCandle(symbol: TradingPair) {
    // Calculate the start of the previous minute to ensure we fetch the last completed candle
    const from = startOfMinute(subMinutes(Date.now(), 1)).getTime();
    const candles = await this.exchange.fetchOHLCV(symbol, { from, limit: 1 });
    const candle = first(candles);
    if (candle) {
      debug(
        'stream',
        [
          `1m candle from ${this.exchange.getExchangeName()} for ${symbol} @ ${toISOString(candle.start)} `,
          `O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`,
        ].join(' '),
      );
      this.push({ symbol, candle });
    } else warning('stream', 'Received undefined candle');
  }

  _read(): void {
    // Data is pushed from the exchange callback
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      this.heart.stop();
    } finally {
      callback(error);
    }
  }
}
