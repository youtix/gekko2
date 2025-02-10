import { Exchange, ExchangeError, NetworkError } from 'ccxt';
import { ExchangeNotHandledError } from '../../../../errors/exchangeNotHandled.error';
import { tradesSchema } from '../../../../models/schema/trade.schema';
import { mapToTrades } from '../../../../utils/trade/trade.utils';
import { logger } from '../../../logger';
import { createExchange, getSymbol } from '../provider.utils';

export class TradeProvider {
  exchange: Exchange;
  symbol: string;

  constructor() {
    this.exchange = createExchange();
    this.symbol = getSymbol();
    if (!this.exchange.has['fetchTrades']) throw new ExchangeNotHandledError('fetchTrades');
  }

  async fetch() {
    try {
      const trades = await this.exchange.fetchTrades(this.symbol, undefined, 1000);
      tradesSchema.validate(trades);
      return mapToTrades(trades);
    } catch (error) {
      if (error instanceof NetworkError) {
        logger.error(
          `${this.exchange.id} fetchTrades failed due to a network error: ${error.message}`,
        );
      } else if (error instanceof ExchangeError) {
        logger.error(
          `${this.exchange.id} fetchTrades failed due to exchange error: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }
}
