import { candlesSchema } from '@models/schema/candle.schema';
import { tradesSchema } from '@models/schema/trade.schema';
import { BrokerConfig } from '@models/types/configuration.types';
import { logger } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { mapToCandles, mapToTrades } from '@utils/trade/trade.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, last } from 'lodash-es';
import { Broker } from '../broker';

export class BinanceBroker extends Broker {
  constructor(brokerConfig: BrokerConfig) {
    super(brokerConfig);
  }

  public async fetchTicker() {
    return await this.broker.fetchTicker(this.symbol);
  }

  public async fetchOHLCV(from?: EpochTimeStamp) {
    const ohlcvList = await this.broker.fetchOHLCV(
      this.symbol,
      this.broker.timeframes['1m'] as string,
      from,
      1000,
    );
    const candles = mapToCandles(ohlcvList);
    candlesSchema.validate(candles);

    logger.debug(
      [
        `Fetched candles from ${this.brokerName}.`,
        `From ${toISOString(first(candles)?.start)}`,
        `to ${toISOString(last(candles)?.start)}`,
        `(${formatDuration(intervalToDuration({ start: first(candles)?.start ?? 0, end: last(candles)?.start ?? 0 }))})`,
      ].join(' '),
    );

    return candles;
  }

  public async fetchTrades() {
    const trades = await this.broker.fetchTrades(this.symbol, undefined, 1000);
    tradesSchema.validate(trades);
    return mapToTrades(trades);
  }
}
