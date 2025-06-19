import { describe, expect, it, Mock, vi } from 'vitest';
import { Candle } from '../../../../models/types/candle.types';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { inject } from '../../../injecter/injecter';
import { HistoricalCandleError } from './historicalCandle.error';
import { HistoricalCandleStream } from './historicalCandle.stream';
import { HistoricalCandleStreamInput } from './historicalCandle.types';

const candleFactory = (time: string, value: number) => ({
  start: toTimestamp(time),
  open: value,
  high: value,
  low: value,
  close: value,
});

vi.mock('@services/logger', () => ({ info: vi.fn() }));
vi.mock('@services/injecter/injecter', () => ({
  inject: { broker: vi.fn() },
}));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(() => ({
    on: vi.fn(),
    pump: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe('HistoricalCandleStream', () => {
  const injectBrokerMock = inject.broker as Mock;
  let stream: HistoricalCandleStream;
  let results: Candle[];

  const launchHistoricalCandleStream = ({ startDate, endDate }: HistoricalCandleStreamInput) => {
    stream = new HistoricalCandleStream({ startDate, endDate });
    results = [];
    stream.on('data', data => results.push(data));
  };

  it('should throw HistoricalCandleError when no candle data is fetched', async () => {
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:00:05Z'),
    });

    await expect(stream.onTick()).rejects.toThrow(HistoricalCandleError);
  });

  it('should push candles and not end stream when fetched candles do not reach end', async () => {
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    const candle2 = candleFactory('2023-01-01T00:00:01Z', 101);
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:00:05Z'),
    });

    await stream.onTick();
    // Wait for any pending data events to be processed.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1, candle2]);
  });

  it('should push candles and end stream when fetched candles meet or exceed end', async () => {
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:00:01Z'),
    });

    await stream.onTick();
    // Wait for pending data events.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1]);
  });
});
