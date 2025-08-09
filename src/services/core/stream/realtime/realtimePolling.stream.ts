import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/types/candle.types';
import { TradeBatcher } from '@services/core/batcher/tradeBatcher/tradeBatcher';
import { CandleManager } from '@services/core/candleManager/candleManager';
import { Heart } from '@services/core/heart/heart';
import { Exchange } from '@services/exchange/exchange';
import { inject } from '@services/injecter/injecter';
import { bindAll, each, every } from 'lodash-es';
import { Readable } from 'node:stream';
import { RealtimePollingStreamInput } from './realtimePolling.types';

export class RealtimePollingStream extends Readable {
  heart: Heart;
  exchange: Exchange;
  candleManager: CandleManager;
  tradeBatcher: TradeBatcher;
  private isLocked: boolean;

  constructor({ tickrate }: RealtimePollingStreamInput) {
    super({ objectMode: true });

    this.heart = new Heart(tickrate);
    this.exchange = inject.exchange();
    this.tradeBatcher = new TradeBatcher();
    this.candleManager = new CandleManager();

    this.isLocked = false;

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    this.heart.on('tick', this.onTick);
    this.heart.pump();
  }

  async onTick() {
    if (this.isLocked) return;
    const trades = await this.exchange.fetchTrades();
    if (!every(trades, 'id'))
      throw new GekkoError('stream', 'One or more trade objects are missing the mandatory property id.');
    const batch = this.tradeBatcher.processTrades(trades);
    if (batch?.data.length) {
      const candles = this.candleManager.processBatch(batch);
      this.pushCandles(candles);
    }
    this.isLocked = false;
  }

  _read(): void {
    // No operation, as data is pushed manually
  }

  pushCandles(candles: Candle[]): void {
    each(candles, this.pushCandle);
  }

  pushCandle(candle: Candle): void {
    this.push(candle);
  }
}
