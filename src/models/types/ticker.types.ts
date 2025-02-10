import { Undefined } from './generic.types';

export interface Ticker {
  symbol: string;
  info: unknown;
  timestamp: Undefined<number>;
  datetime: Undefined<string>;
  high: Undefined<number>;
  low: Undefined<number>;
  bid: Undefined<number>;
  bidVolume: Undefined<number>;
  ask: Undefined<number>;
  askVolume: Undefined<number>;
  vwap: Undefined<number>;
  open: Undefined<number>;
  close: Undefined<number>;
  last: Undefined<number>;
  previousClose: Undefined<number>;
  change: Undefined<number>;
  percentage: Undefined<number>;
  average: Undefined<number>;
  quoteVolume: Undefined<number>;
  baseVolume: Undefined<number>;
  indexPrice: Undefined<number>;
  markPrice: Undefined<number>;
}
