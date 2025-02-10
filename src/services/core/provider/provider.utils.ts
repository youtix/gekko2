import ccxt, { exchanges } from 'ccxt';
import { config } from '../../configuration/configuration';

export const createExchange = () => {
  const exchangeName = config.getWatch().exchange as keyof typeof exchanges;
  const exchange = new ccxt[exchangeName]();
  exchange.options['maxRetriesOnFailure'] = 20;
  exchange.options['maxRetriesOnFailureDelay'] = 1000;
  return exchange;
};

export const getSymbol = () => {
  const { currency, asset } = config.getWatch();
  return `${asset}/${currency}`;
};
