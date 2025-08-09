import ccxt from 'ccxt';

export type ExchangeNames = keyof (typeof ccxt)['pro'];
