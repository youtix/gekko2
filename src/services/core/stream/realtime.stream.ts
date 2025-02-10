import { Broker } from '@services/broker/broker';
import { inject } from '@services/storage/injecter';
import { bindAll, each } from 'lodash-es';
import { Readable } from 'node:stream';
import { Candle } from '../../../models/types/candle.types';
import { config } from '../../configuration/configuration';
import { logger } from '../../logger';
import { TradeBatcher } from '../batcher/tradeBatcher/tradeBatcher';
import { CandleManager } from '../candleManager/candleManager';
import { Heart } from '../heart/heart';

export class RealtimeStream extends Readable {
  heart: Heart;
  tradeProvider: Broker;
  candleManager: CandleManager;
  tradeBatcher: TradeBatcher;

  constructor() {
    super({ objectMode: true });

    this.heart = new Heart(config.getWatch().tickrate ?? 10);
    this.tradeProvider = inject.broker();
    this.tradeBatcher = new TradeBatcher();
    this.candleManager = new CandleManager();

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    this.heart.on('tick', this.onTick);

    this.heart.pump();
  }

  async onTick() {
    const trades = await this.tradeProvider.fetchTrades();
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
