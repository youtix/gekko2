import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { Exchange } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { debug, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeStream extends Readable {
  private readonly exchange: Exchange;
  private readonly unsubscribe: () => void;

  constructor() {
    super({ objectMode: true });
    const { pairs } = config.getWatch();
    this.exchange = inject.exchange();
    const { symbol } = pairs[0]; // TODO: support multiple pairs

    bindAll(this, ['onNewCandle']);

    this.unsubscribe = this.exchange.onNewCandle(symbol, this.onNewCandle);
  }

  private onNewCandle(symbol: TradingPair, candle: Candle | undefined) {
    if (candle) {
      debug(
        'stream',
        [
          `1m candle from ${this.exchange.getExchangeName()} for ${symbol} @ ${toISOString(candle.start)} `,
          `O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`,
        ].join(' '),
      );
    } else warning('stream', 'Received undefined candle');
    this.push({ symbol, candle });
  }

  _read(): void {
    // Data is pushed from the websocket callback
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      this.unsubscribe();
    } finally {
      callback(error);
    }
  }
}
