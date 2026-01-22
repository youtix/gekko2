import { TradingPair } from '@models/utility.types';

export type HistoricalCandleStreamInput = {
  /** It represents the beginning of the period from which candles are fetched. (timestamp in miliseconds) */
  startDate: EpochTimeStamp;

  /** It represents the end of the period up to which candles are fetched. (timestamp in miliseconds) */
  endDate: EpochTimeStamp;

  /** The tickrate in milliseconds, which determines how frequently the stream should emit events. Default value is 1 second if not provided. */
  tickrate: number;

  /** The symbol for which candles are fetched. */
  symbol: TradingPair;
};
