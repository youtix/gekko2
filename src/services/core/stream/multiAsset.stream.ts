import { TradingPair } from '@models/utility.types';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { Readable } from 'stream';

/**
 * Builds one candle stream per pair with `createStream` and emits their candles as `CandleBucket`s, synchronised by
 * timestamp. Back-pressure is relayed to the synchronised stream, and an error of any pair destroys this stream with it.
 */
export class MultiAssetStream extends Readable {
  private readonly synchronizedStream: Readable;

  constructor(pairs: { symbol: TradingPair }[], createStream: (symbol: TradingPair) => Readable) {
    super({ objectMode: true });
    this.synchronizedStream = synchronizeStreams(pairs.map(({ symbol }) => createStream(symbol)));

    this.synchronizedStream.on('data', chunk => {
      if (!this.push(chunk)) this.synchronizedStream.pause();
    });
    this.synchronizedStream.on('end', () => this.push(null));
    this.synchronizedStream.on('error', error => this.destroy(error));
  }

  _read() {
    this.synchronizedStream.resume();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.synchronizedStream.destroy(error ?? undefined);
    callback(error);
  }
}
