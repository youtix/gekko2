import { Exchange, ExchangeError, NetworkError } from 'ccxt';
import { formatDuration, intervalToDuration } from 'date-fns';
import { first, last } from 'lodash-es';
import { ExchangeNotHandledError } from '../../../../errors/exchangeNotHandled.error';
import { candlesSchema } from '../../../../models/schema/candle.schema';
import { toISOString } from '../../../../utils/date/date.utils';
import { mapToCandles } from '../../../../utils/trade/trade.utils';
import { logger } from '../../../logger';
import { createExchange, getSymbol } from '../provider.utils';

export class CandleProvider {
  exchange: Exchange;
  symbol: string;

  constructor() {
    this.exchange = createExchange();
    this.symbol = getSymbol();
    if (!this.exchange.has['fetchOHLCV']) throw new ExchangeNotHandledError('fetchOHLCV');
    if (!this.exchange.timeframes['1m']) throw new ExchangeNotHandledError('timeframe 1 minute');
  }

  async fetch(from?: EpochTimeStamp) {
    try {
      const ohlcvList = await this.exchange.fetchOHLCV(
        this.symbol,
        this.exchange.timeframes['1m'] as string,
        from,
        1000,
      );
      const candles = mapToCandles(ohlcvList);
      candlesSchema.validate(candles);

      logger.debug(
        [
          `Fetched candles from ${this.exchange.id}.`,
          `From ${toISOString(first(candles)?.start)}`,
          `to ${toISOString(last(candles)?.start)}`,
          `(${formatDuration(intervalToDuration({ start: first(candles)?.start ?? 0, end: last(candles)?.start ?? 0 }))})`,
        ].join(' '),
      );

      return candles;
    } catch (error) {
      if (error instanceof NetworkError) {
        logger.error(
          `${this.exchange.id} fetchOHLCV failed due to a network error: ${error.message}`,
        );
      } else if (error instanceof ExchangeError) {
        logger.error(
          `${this.exchange.id} fetchOHLCV failed due to exchange error: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }
}
