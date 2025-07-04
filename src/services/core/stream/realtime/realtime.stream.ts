import { Candle } from '@models/types/candle.types';
import { Broker } from '@services/broker/broker';
import { TradeBatcher } from '@services/core/batcher/tradeBatcher/tradeBatcher';
import { CandleManager } from '@services/core/candleManager/candleManager';
import { Heart } from '@services/core/heart/heart';
import { inject } from '@services/injecter/injecter';
import { warning } from '@services/logger';
import { bindAll, each } from 'lodash-es';
import { Readable } from 'node:stream';
import { RealtimeStreamInput } from './realtime.types';

export class RealtimeStream extends Readable {
  heart: Heart;
  broker: Broker;
  candleManager: CandleManager;
  tradeBatcher: TradeBatcher;

  constructor({ tickrate = 10, threshold = 0 }: RealtimeStreamInput = {}) {
    super({ objectMode: true });

    this.heart = new Heart(tickrate);
    this.broker = inject.broker();
    this.tradeBatcher = new TradeBatcher(threshold);
    this.candleManager = new CandleManager();

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    this.heart.on('tick', this.onTick);
    this.heart.pump();
  }

  async onTick() {
    const trades = await this.broker.fetchTrades();
    const batch = this.tradeBatcher.processTrades(trades);
    if (!batch?.data.length) return warning('stream', 'No Candle');
    const candles = this.candleManager.processBacth(batch);
    this.pushCandles(candles);
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
