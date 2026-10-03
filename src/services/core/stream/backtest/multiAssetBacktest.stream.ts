import { TradingPair } from '@models/utility.types';
import { Interval } from 'date-fns';
import { MultiAssetStream } from '../multiAsset.stream';
import { BacktestStream } from './backtest.stream';

export type MultiAssetBacktestStreamParams = {
  pairs: { symbol: TradingPair }[];
  daterange: Interval<EpochTimeStamp, EpochTimeStamp>;
};

/** The stored candles of every pair, as synchronised `CandleBucket`s */
export class MultiAssetBacktestStream extends MultiAssetStream {
  constructor({ pairs, daterange }: MultiAssetBacktestStreamParams) {
    super(pairs, symbol => new BacktestStream({ daterange, symbol }));
  }
}
