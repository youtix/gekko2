import { config } from '@services/configuration/configuration';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { resetDateParts, toTimestamp } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { subMinutes } from 'date-fns';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { describe, expect, it, Mock, vi } from 'vitest';
import { BacktestStream } from '../stream/backtest/backtest.stream';
import { CandleValidatorStream } from '../stream/candleValidator/candleValidator.stream';
import { HistoricalCandleStream } from '../stream/historicalCandle/historicalCandle.stream';
import { PluginsStream } from '../stream/plugins.stream';
import { RealtimeStream } from '../stream/realtime/realtime.stream';
import { mergeSequentialStreams, streamPipelines } from './pipeline.utils';

// Mocks
vi.mock('@plugins/plugin', () => ({
  Plugin: class {},
}));
vi.mock('@constants/timeframe.const', () => ({
  TIMEFRAME_TO_MINUTES: { '1m': 1 },
}));

// Mock both alias and relative path if necessary, but alias should work if configured.
// However, to be safe against leakage or alias mismatch:
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

vi.mock('date-fns', () => ({
  subMinutes: vi.fn(),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

// Mock Stream Classes
vi.mock('../stream/backtest/backtest.stream', () => ({
  BacktestStream: vi.fn(),
}));
vi.mock('../stream/candleValidator/candleValidator.stream', () => ({
  CandleValidatorStream: vi.fn(),
}));
vi.mock('../stream/historicalCandle/historicalCandle.stream', () => ({
  HistoricalCandleStream: vi.fn(),
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

        (processStartTime as Mock).mockReturnValue(new Date('2023-01-01T12:00:00.123Z'));
        (resetDateParts as Mock).mockReturnValue(mockNow);
        (getCandleTimeOffset as Mock).mockReturnValue(mockOffset);
        (subMinutes as Mock).mockReturnValue(mockStartDate);

        const mockWatchConfig = {
          pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
          warmup: { candleCount: 60, tickrate: 1000 },
        };
        (config.getWatch as Mock).mockReturnValue(mockWatchConfig);

        await streamPipelines.realtime(mockPlugins);

        expect(processStartTime).toHaveBeenCalled();
        expect(resetDateParts).toHaveBeenCalledWith(expect.anything(), ['s', 'ms']);
        // Timeframe 1m = 1 minute. Warmup 60. Offset 0.
        // subMinutes called with (now, 60 * 1 + 0)
        expect(subMinutes).toHaveBeenCalledWith(mockNow, 60);

        // Verify Streams Initialization
        expect(HistoricalCandleStream).toHaveBeenCalledWith({
          startDate: mockStartDate.getTime(),
          endDate: mockNow,
          tickrate: 1000,
        });
        expect(RealtimeStream).toHaveBeenCalled();
        expect(CandleValidatorStream).toHaveBeenCalled();
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);

        // check correct composition is passed to pipeline
        // The first argument to pipeline is the merged stream. We can't strictly equal check the generator result easily without consuming it,
        // but we can check if pipeline was called.
        expect(pipeline).toHaveBeenCalled();
      });
    });

    describe('backtest', () => {
      it('should build backtest pipeline correctly', async () => {
        const mockDaterange = { start: '2023-01-01', end: '2023-01-02' };
        (config.getWatch as Mock).mockReturnValue({ daterange: mockDaterange });
        (toTimestamp as Mock).mockImplementation(date => new Date(date).getTime());

        await streamPipelines.backtest(mockPlugins);

        expect(config.getWatch).toHaveBeenCalled();
        expect(toTimestamp).toHaveBeenCalledWith(mockDaterange.start);
        expect(toTimestamp).toHaveBeenCalledWith(mockDaterange.end);

        expect(BacktestStream).toHaveBeenCalledWith({
          start: new Date(mockDaterange.start).getTime(),
          end: new Date(mockDaterange.end).getTime(),
        });
        expect(CandleValidatorStream).toHaveBeenCalled();
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);
        expect(pipeline).toHaveBeenCalled();
      });
    });

    describe('importer', () => {
      it('should build importer pipeline correctly', async () => {
        const mockDaterange = { start: '2023-01-01', end: '2023-01-02' };
        const mockTickrate = 500;

        (config.getWatch as Mock).mockReturnValue({
          daterange: mockDaterange,
          tickrate: mockTickrate,
        });
        (toTimestamp as Mock).mockImplementation(date => new Date(date).getTime());

        await streamPipelines.importer(mockPlugins);

        expect(config.getWatch).toHaveBeenCalled();
        expect(HistoricalCandleStream).toHaveBeenCalledWith({
          startDate: new Date(mockDaterange.start).getTime(),
          endDate: new Date(mockDaterange.end).getTime(),
          tickrate: mockTickrate,
        });
        expect(CandleValidatorStream).toHaveBeenCalled();
        expect(PluginsStream).toHaveBeenCalledWith(mockPlugins);
        expect(pipeline).toHaveBeenCalled();
      });
    });
  });
});
