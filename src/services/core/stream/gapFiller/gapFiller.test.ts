import { describe, expect, it, Mock, vi } from 'vitest';
import { Candle } from '../../../../models/types/candle.types';
import * as utils from '../../../../utils/candle/candle.utils';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { config } from '../../../configuration/configuration';
import { GapFillerStream } from './gapFiller.stream';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getWatch: vi.fn() }));
  return { config: new Configuration() };
});
vi.mock('@utils/candle/candle.utils', () => ({
  fillMissingCandles: vi.fn(),
  // bridgeCandleGap: vi.fn(),
}));

const candleFactory = (start: number, open: number, close: number, high: number, low: number, volume: number) => ({
  start,
  open,
  close,
  high,
  low,
  volume,
});

describe('GapFillerStream', () => {
  const startCandle = candleFactory(toTimestamp('2025-01-01T00:01:00.000'), 100, 100, 110, 90, 10);
  const endCandle = candleFactory(toTimestamp('2025-01-01T00:04:00.000'), 105, 105, 115, 95, 12);
  const getWatchMock = config.getWatch as Mock;
  const fillMissingCandlesMock = utils.fillMissingCandles as Mock;
  // const bridgeCandleGapMock = utils.bridgeCandleGap as Mock;
  let stream: GapFillerStream;

  const launchStream = (...candles: Candle[]) => {
    return new Promise(resolve => {
      stream = new GapFillerStream();
      const results: Candle[] = [];
      stream.on('data', data => results.push(data));
      stream.on('end', () => resolve(results));
      for (const candle of candles) stream.write(candle);
      stream.end();
    });
  };

  it('should pass through stream without filling or ignoring candles', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'empty', mode: 'backtest' });
    const candle2 = candleFactory(toTimestamp('2025-01-01T00:02:00.000'), 150, 150, 120, 80, 0);
    const candle3 = candleFactory(toTimestamp('2025-01-01T00:03:00.000'), 150, 150, 120, 80, 0);
    const results = await launchStream(startCandle, candle2, candle3, endCandle);
    expect(results).toEqual([startCandle, candle2, candle3, endCandle]);
  });

  it('should pass through candles without filling gaps when mode is "no"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'no', mode: 'backtest' });
    const results = await launchStream(startCandle, endCandle); // Missing Candle Gap
    expect(results).toEqual([startCandle, endCandle]);
  });

  it('should fill gaps with empty candles when mode is "empty"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'empty', mode: 'realtime' });
    const syntheticEmptyCandle1 = candleFactory(toTimestamp('2025-01-01T00:02:00.000'), 100, 100, 110, 90, 0);
    const syntheticEmptyCandle2 = candleFactory(toTimestamp('2025-01-01T00:03:00.000'), 100, 100, 110, 90, 0);
    fillMissingCandlesMock.mockReturnValue([startCandle, syntheticEmptyCandle1, syntheticEmptyCandle2, endCandle]);
    const results = await launchStream(startCandle, endCandle);
    expect(results).toEqual([startCandle, syntheticEmptyCandle1, syntheticEmptyCandle2, endCandle]);
  });
  it('should ignore the current candle which is the same candle than last one"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'no', mode: 'realtime' });
    const candle2 = candleFactory(toTimestamp('2025-01-01T00:02:00.000'), 100, 100, 110, 90, 0);
    const candle3 = candleFactory(toTimestamp('2025-01-01T00:02:00.000'), 100, 100, 110, 90, 0);
    const candle4 = candleFactory(toTimestamp('2025-01-01T00:03:00.000'), 101, 101, 111, 91, 1);
    const results = await launchStream(startCandle, candle2, candle3, candle4, endCandle);
    expect(results).toEqual([startCandle, candle2, candle4, endCandle]);
  });
  it('should ignore current candle which is older than last one"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'no', mode: 'realtime' });
    const candle2 = candleFactory(toTimestamp('2025-01-01T00:02:00.000'), 100, 100, 110, 90, 0);
    const candle3 = candleFactory(toTimestamp('2025-01-01T00:00:00.000'), 100, 100, 110, 90, 0);
    const candle4 = candleFactory(toTimestamp('2025-01-01T00:03:00.000'), 101, 101, 111, 91, 1);
    const results = await launchStream(startCandle, candle2, candle3, candle4, endCandle);
    expect(results).toEqual([startCandle, candle2, candle4, endCandle]);
  });

  // it('should fill gaps with exchange candles when mode is "exchange"', async () => {
  //   const candle2 = candleFactory(2000, 100, 100, 110, 90, 0);
  //   const candle3 = candleFactory(3000, 100, 100, 110, 90, 0);
  //   bridgeCandleGapMock.mockReturnValue([candle2, candle3]);
  //   getWatchMock.mockReturnValue({ fillGaps: 'exchange', mode: 'importer' });
  //   const results = await resetStream();
  //   expect(results).toEqual([startCandle, candle2, candle3, endCandle]);
  // });
});
