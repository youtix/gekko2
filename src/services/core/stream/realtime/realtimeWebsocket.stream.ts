import { Candle } from '@models/candle.types';
import { candleSchema } from '@models/schema/candle.schema';
import { Exchange } from '@services/exchange/exchange';
import { inject } from '@services/injecter/injecter';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeWebsocketStream extends Readable {
  private readonly exchange: Exchange;
  private readonly unsubscribe: () => void;

  constructor() {
    super({ objectMode: true });
    this.exchange = inject.exchange();

    bindAll(this, ['onNewCandle']);

    this.unsubscribe = this.exchange.onNewCandle(this.onNewCandle);
  }

  private onNewCandle(candle: Candle) {
    debug(
      'stream',
      [
        `1m candle from ${this.exchange.getExchangeName()} for ${this.exchange.getSymbol()} @ ${toISOString(candle.start)} `,
        `O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume}`,
      ].join(' '),
    );

    candleSchema.validate(candle);
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
