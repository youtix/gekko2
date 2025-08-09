import { Candle } from '@models/types/candle.types';
import { Trade } from '@models/types/trade.types';
import { Exchange } from '@services/exchange/exchange';
import { inject } from '@services/injecter/injecter';
import { MINUTE_MS } from '@utils/date/date.const';
import { resetDateParts } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { bindAll } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeWebsocketStream extends Readable {
  private static readonly MINUTE_MS = 60_000;

  private readonly exchange: Exchange;
  private readonly unsubscribe: () => void;
  private threshold: number;

  private curStart = -1; // minute start timestamp (ms)
  private o = 0;
  private h = 0;
  private l = 0;
  private c = 0;
  private v = 0;

  constructor() {
    super({ objectMode: true });
    this.exchange = inject.exchange();
    this.threshold = resetDateParts(processStartTime(), ['s', 'ms']);

    bindAll(this, ['onTrade']);

    this.unsubscribe = this.exchange.onTrade(this.onTrade);
  }

  private onTrade(trade: Trade) {
    if (trade.amount <= 0) return;

    const ts = trade.timestamp | 0; // coerce to int
    if (ts < this.threshold) return;

    const price = trade.price;
    if (price <= 0) return;

    const start = ts - (ts % MINUTE_MS);

    // New minute detected -> flush previous candle
    if (this.curStart !== -1 && start !== this.curStart) {
      const candle: Candle = {
        start: this.curStart,
        open: this.o,
        high: this.h,
        low: this.l,
        close: this.c,
        volume: this.v,
      };
      this.push(candle);

      // (Optional gap handling could be added here if you want to emit empty candles.)
      // Initialize state for the new minute with the current trade
      this.curStart = start;
      this.o = price;
      this.h = price;
      this.l = price;
      this.c = price;
      this.v = trade.amount;
      return;
    }

    // First trade ever (initialize) or same minute (update)
    if (this.curStart === -1) {
      this.curStart = start;
      this.o = price;
      this.h = price;
      this.l = price;
      this.c = price;
      this.v = trade.amount;
    } else {
      // Same minute: update OHLCV with branchless-ish min/max
      if (price > this.h) this.h = price;
      if (price < this.l) this.l = price;
      this.c = price;
      this.v += trade.amount;
    }
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
