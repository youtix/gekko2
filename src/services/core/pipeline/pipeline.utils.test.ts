import { config } from '@services/configuration/configuration';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { resetDateParts, toTimestamp } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { synchronizeStreams } from '@utils/stream/stream.utils';
import { subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { MultiAssetBacktestStream } from '../stream/backtest/multiAssetBacktest.stream';
import { MultiAssetHistoricalStream } from '../stream/multiAssetHistorical.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';
import { RejectDuplicateCandleStream } from '../stream/validation/rejectDuplicateCandle.stream';
import { mergeSequentialStreams, streamPipelines } from './pipeline.utils';

// Mocks
vi.mock('@plugins/plugin', () => ({
  Plugin: class {},
}));
vi.mock('@constants/timeframe.const', () => ({
  TIMEFRAME_TO_MINUTES: { '1m': 1 },
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
  },
}));

vi.mock('@utils/candle/candle.utils', () => ({
  getCandleTimeOffset: vi.fn(),
}));

vi.mock('@utils/date/date.utils', () => ({
  resetDateParts: vi.fn(),
  toTimestamp: vi.fn(),
}));

vi.mock('@utils/process/process.utils', () => ({
  processStartTime: vi.fn(),
}));

vi.mock('@utils/stream/stream.utils', () => ({
  synchronizeStreams: vi.fn(),
}));

vi.mock('date-fns', () => ({
  subMinutes: vi.fn(),
  formatDuration: vi.fn().mockReturnValue('1h 30m'),
  intervalToDuration: vi.fn(),
}));

vi.mock('@services/logger', () => ({
  info: vi.fn(),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

// Mock Stream Classes
vi.mock('../stream/backtest/backtest.stream', () => ({
  BacktestStream: vi.fn(),
}));
vi.mock('../stream/backtest/multiAssetBacktest.stream', () => ({
  MultiAssetBacktestStream: vi.fn(),
}));
vi.mock('../stream/validation/rejectDuplicateCandle.stream', () => ({
  RejectDuplicateCandleStream: vi.fn(),
}));
// Clean up old mocks if possible, or just overwrite
vi.mock('../stream/historicalCandle/historicalCandle.stream', () => ({
  HistoricalCandleStream: vi.fn(),
}));

vi.mock('../stream/multiAssetHistorical.stream', () => ({
  MultiAssetHistoricalStream: vi.fn(),
}));

vi.mock('../stream/plugins.stream', () => ({
  PluginsStream: vi.fn(),
}));
vi.mock('../stream/realtime/realtime.stream', () => ({
  RealtimeStream: vi.fn(),
}));

describe('Pipeline Utils', () => {
  describe('mergeSequentialStreams', () => {
    it.each`
      values1   | values2 | expected
      ${[1, 2]} | ${[3]}  | ${[1, 2, 3]}
      ${[]}     | ${[1]}  | ${[1]}
      ${[1]}    | ${[]}   | ${[1]}
      ${[]}     | ${[]}   | ${[]}
    `('should merge streams with $values1 and $values2 to $expected', async ({ values1, values2, expected }) => {
      const s1 = Readable.from(values1);
      const s2 = Readable.from(values2);
      const merged = mergeSequentialStreams(s1, s2);

      const result: unknown[] = [];
      for await (const chunk of merged) {
        result.push(chunk);
      }

      expect(result).toEqual(expected);
    });
  });

  describe('streamPipelines', () => {
    const mockPlugins = [] as any;

    describe('realtime', () => {
      it('should build realtime pipeline correctly', async () => {
        const mockNow = new Date('2023-01-01T12:00:00Z');
        const mockStartDate = new Date('2023-01-01T11:00:00Z'); // 60 mins ago
        const mockOffset = 0;
        const mockPairs = [{ symbol: 'BTC/USDT', timeframe: '1m' }];

        (processStartTime as Mock).mockReturnValue(new Date('2023-01-01T12:00:00.123Z'));
        (resetDateParts as Mock).mockReturnValue(mockNow);
        (getCandleTimeOffset as Mock).mockReturnValue(mockOffset);
        (subMinutes as Mock).mockReturnValue(mockStartDate);

        const mockWatchConfig = {
          pairs: mockPairs,
          warmup: { candleCount: 60, tickrate: 1000 },
          timeframe: '1m',
        };
        (config.getWatch as Mock).mockReturnValue(mockWatchConfig);

        await streamPipelines.realtime(mockPlugins);

        expect(processStartTime).toHaveBeenCalled();
        expect(resetDateParts).toHaveBeenCalledWith(expect.anything(), ['s', 'ms']);
        expect(subMinutes).toHaveBeenCalledWith(mockNow, 60);

        // Verify Streams Initialization
        expect(MultiAssetHistoricalStream).toHaveBeenCalledWith({
          daterange: {
            start: mockStartDate.getTime(),
            end: mockNow,
          },
          tickrate: 1000,
          pairs: mockPairs,
        });

        expect(RealtimeStream).toHaveBeenCalledWith('BTC/USDT');
        expect(synchronizeStreams).toHaveBeenCalled();

        expect(RejectDuplicateCandleStream).toHaveBeenCalled();
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);

        expect(pipeline).toHaveBeenCalled();
      });
    });

    describe('backtest', () => {
      it('should build backtest pipeline correctly', async () => {
        const mockDaterange = {
          start: new Date('2023-01-01').getTime(),
          end: new Date('2023-01-02').getTime(),
        };
        const mockPairs = [{ symbol: 'BTC/USDT' }];
        (config.getWatch as Mock).mockReturnValue({ daterange: mockDaterange, pairs: mockPairs });
        (toTimestamp as Mock).mockImplementation(date => new Date(date).getTime());

        await streamPipelines.backtest(mockPlugins);

        expect(config.getWatch).toHaveBeenCalled();

        expect(MultiAssetBacktestStream).toHaveBeenCalledWith({
          daterange: {
            start: new Date(mockDaterange.start).getTime(),
            end: new Date(mockDaterange.end).getTime(),
          },
          pairs: mockPairs,
        });
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);
        expect(pipeline).toHaveBeenCalled();
      });
    });

    describe('importer', () => {
      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should build importer pipeline correctly using MultiAssetHistoricalStream', async () => {
        const mockDaterange = {
          start: new Date('2023-01-01').getTime(),
          end: new Date('2023-01-02').getTime(),
        };
        const mockTickrate = 500;
        const mockPairs = [{ symbol: 'BTC/USDT', timeframe: '1m' }];

        (config.getWatch as Mock).mockReturnValue({
          daterange: mockDaterange,
          tickrate: mockTickrate,
          pairs: mockPairs,
        });
        (toTimestamp as Mock).mockImplementation(date => new Date(date).getTime());

        await streamPipelines.importer(mockPlugins);

        expect(config.getWatch).toHaveBeenCalled();
        expect(MultiAssetHistoricalStream).toHaveBeenCalledWith({
          daterange: mockDaterange,
          tickrate: mockTickrate,
          pairs: mockPairs,
        });
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);
        expect(pipeline).toHaveBeenCalled();
      });

      it('should handle multiple pairs in importer by passing them to MultiAssetHistoricalStream', async () => {
        const mockPairs = [
          { symbol: 'BTC/USDT', timeframe: '1m' },
          { symbol: 'ETH/USDT', timeframe: '1m' },
        ];
        (config.getWatch as Mock).mockReturnValue({
          daterange: { start: 0, end: 100 },
          tickrate: 500,
          pairs: mockPairs,
        });

        await streamPipelines.importer(mockPlugins);

        expect(MultiAssetHistoricalStream).toHaveBeenCalledWith(expect.objectContaining({ pairs: mockPairs }));
      });
    });
  });
});
