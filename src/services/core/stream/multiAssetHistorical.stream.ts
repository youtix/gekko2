import { TradingPair } from '@models/utility.types';
import { Interval } from 'date-fns';
import { HistoricalCandleStream } from './historicalCandle/historicalCandle.stream';
import { MultiAssetStream } from './multiAsset.stream';

export type MultiAssetHistoricalStreamParams = {
  pairs: { symbol: TradingPair }[];
  daterange: Interval<EpochTimeStamp, EpochTimeStamp>;
  tickrate: number;
};

/** The exchange history of every pair, as synchronised `CandleBucket`s */
export class MultiAssetHistoricalStream extends MultiAssetStream {
  constructor({ pairs, daterange, tickrate }: MultiAssetHistoricalStreamParams) {
    super(pairs, symbol => new HistoricalCandleStream({ daterange, tickrate, symbol }));
  }
}
