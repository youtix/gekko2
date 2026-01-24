import { TradingPair } from '@models/utility.types';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { Interval } from 'date-fns';
import { Readable } from 'stream';
import { BacktestStream } from './backtest.stream';

export type MultiAssetBacktestStreamParams = {
  pairs: { symbol: TradingPair }[];
  daterange: Interval<EpochTimeStamp, EpochTimeStamp>;
};

export class MultiAssetBacktestStream extends Readable {
  private readonly synchronizedStream: Readable;

  constructor({ pairs, daterange }: MultiAssetBacktestStreamParams) {
    super({ objectMode: true });

    const streams = pairs.map(({ symbol }) => new BacktestStream({ daterange, symbol }));

    this.synchronizedStream = synchronizeStreams(streams);

    // Forward data from synchronized stream to this stream
    this.synchronizedStream.on('data', chunk => {
      if (!this.push(chunk)) {
        this.synchronizedStream.pause();
      }
    });

    this.synchronizedStream.on('end', () => {
      this.push(null);
    });

    this.synchronizedStream.on('error', err => {
      this.emit('error', err);
    });
  }

  _read() {
    this.synchronizedStream.resume();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.synchronizedStream.destroy(error ?? undefined);
    callback(error);
  }
}
