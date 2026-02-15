import { TradingPair } from '@models/utility.types';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { Interval } from 'date-fns';
import { Readable } from 'stream';
import { describe, expect, it, Mock, vi } from 'vitest';
import { BacktestStream } from './backtest.stream';
import { MultiAssetBacktestStream } from './multiAssetBacktest.stream';

// Mock dependencies
vi.mock('./backtest.stream', () => ({
  BacktestStream: vi.fn(),
}));

vi.mock('@utils/stream/stream.utils', () => ({
  synchronizeStreams: vi.fn(),
}));

describe('MultiAssetBacktestStream', () => {
  it('should instantiate BacktestStream for each pair and synchronize them', () => {
    const pairs = [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }] as { symbol: TradingPair }[];
    const daterange: Interval<EpochTimeStamp, EpochTimeStamp> = { start: 1000, end: 2000 };

    // Mock BacktestStream instances
    const stream1 = new Readable({ read: () => {} });
    const stream2 = new Readable({ read: () => {} });

    (BacktestStream as unknown as Mock).mockImplementation(function (this: any, { symbol }: any) {
      if (symbol === 'BTC/USDT') return stream1;
      if (symbol === 'ETH/USDT') return stream2;
      return stream1;
    });

    // Mock synchronizeStreams return
    const syncedStream = new Readable({ objectMode: true, read: () => {} });
    (synchronizeStreams as Mock).mockReturnValue(syncedStream);

    const multiStream = new MultiAssetBacktestStream({ pairs, daterange });

    // Verify BacktestStream instantiation
    expect(BacktestStream).toHaveBeenCalledTimes(2);
    expect(BacktestStream).toHaveBeenNthCalledWith(1, { daterange, symbol: 'BTC/USDT' });
    expect(BacktestStream).toHaveBeenNthCalledWith(2, { daterange, symbol: 'ETH/USDT' });

    // Verify synchronizeStreams call
    expect(synchronizeStreams).toHaveBeenCalledWith([stream1, stream2]);

    // Verify data piping (optional, but good to check if listening)
    // We can leak an event from syncedStream and see if multiStream emits it
    const event = { symbol: 'BTC/USDT', candle: { start: 1000 } };

    // Set up a listener on multiStream
    const dataSpy = vi.fn();
    multiStream.on('data', dataSpy);

    // Push data to syncedStream
    syncedStream.push(event);

    // Since streams are async, we might need to wait a tick, but Readable push is synchronous if paused?
    // Let's pump it
    multiStream.read(); // Trigger read which calls synchronizedStream.resume()

    // Actually, in constructor:
    // this.synchronizedStream.on('data', chunk => { if (!this.push(chunk)) ... })

    // So if syncedStream emits data, multiStream should emit data.
    // syncedStream.push(event) should accept it if not full.

    // Wait for event loop
    return new Promise<void>(resolve => {
      setImmediate(() => {
        expect(dataSpy).toHaveBeenCalledWith(event);
        resolve();
      });
    });
  });
});
