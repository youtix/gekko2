import ccxt from 'ccxt';

export type BrokerNames = keyof (typeof ccxt)['pro'];
