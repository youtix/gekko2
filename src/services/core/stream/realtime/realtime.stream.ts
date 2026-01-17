import { Candle } from '@models/candle.types';
import { candleSchema } from '@models/schema/candle.schema';
import { config } from '@services/configuration/configuration';
import { Exchange } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeStream extends Readable {
  private readonly exchange: Exchange;
  private readonly unsubscribe: () => void;
  private readonly symbol: string;

  constructor() {
    super({ objectMode: true });
    const { pairs } = config.getWatch();
    const { symbol } = pairs[0]; // TODO: support multiple pairs
    this.exchange = inject.exchange();
    this.symbol = symbol;

    bindAll(this, ['onNewCandle']);

    this.unsubscribe = this.exchange.onNewCandle(this.onNewCandle);
  }

  private onNewCandle(candle: Candle) {
    debug(
      'stream',
      [
        `1m candle from ${this.exchange.getExchangeName()} for ${this.symbol} @ ${toISOString(candle.start)} `,
        `O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`,
      ].join(' '),
    );

    candleSchema.parse(candle);
    this.push(candle);
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
