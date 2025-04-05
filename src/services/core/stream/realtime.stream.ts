import { Candle } from '@models/types/candle.types';
import { Broker } from '@services/broker/broker';
import { config } from '@services/configuration/configuration';
import { TradeBatcher } from '@services/core/batcher/tradeBatcher/tradeBatcher';
import { CandleManager } from '@services/core/candleManager/candleManager';
import { Heart } from '@services/core/heart/heart';
import { logger } from '@services/logger';
import { inject } from '@services/storage/injecter/injecter';
import { bindAll, each } from 'lodash-es';
import { Readable } from 'node:stream';

export class RealtimeStream extends Readable {
  heart: Heart;
  broker: Broker;
  candleManager: CandleManager;
  tradeBatcher: TradeBatcher;

  constructor() {
    super({ objectMode: true });

    this.heart = new Heart(config.getWatch().tickrate ?? 10);
    this.broker = inject.broker();
    this.tradeBatcher = new TradeBatcher();
    this.candleManager = new CandleManager();

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    this.heart.on('tick', this.onTick);

    this.heart.pump();
  }

  async onTick() {
    const trades = await this.broker.fetchTrades();
    const batch = this.tradeBatcher.processTrades(trades);
    if (!batch?.data.length) {
      logger.warn('No Candle');
      return;
    }
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
