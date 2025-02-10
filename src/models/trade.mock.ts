import { Trade } from 'ccxt';

export const generateTrade = (trade: Partial<Trade>) => ({
  info: {}, // the original decoded JSON as is
  id: '12345-67890:09876/54321', // string trade id
  timestamp: 1502962946216, // Unix timestamp in milliseconds
  datetime: '2017-08-17 12:42:48.000', // ISO8601 datetime with milliseconds
  symbol: 'ETH/BTC', // symbol
  order: '12345-67890:09876/54321', // string order id or undefined/None/null
  type: 'limit', // order type, 'market', 'limit' or undefined/None/null
  side: 'buy', // direction of the trade, 'buy' or 'sell'
  takerOrMaker: 'taker', // string, 'taker' or 'maker'
  price: 0.06917684, // float price in quote currency
  amount: 1.5, // amount of base currency
  cost: 0.10376526, // total cost, `price * amount`,
  fee: {
    // provided by exchange or calculated by ccxt
    cost: 0.0015, // float
    currency: 'ETH', // usually base currency for buys, quote currency for sells
    rate: 0.002, // the fee rate (if available)
  },
  fees: [
    // an array of fees if paid in multiple currencies
    {
      // if provided by exchange or calculated by ccxt
      cost: 0.0015, // float
      currency: 'ETH', // usually base currency for buys, quote currency for sells
      rate: 0.002, // the fee rate (if available)
    },
  ],
  ...trade,
});
