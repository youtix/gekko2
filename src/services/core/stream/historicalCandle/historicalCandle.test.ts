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
  inject: { exchange: vi.fn() },
}));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(() => ({
    on: vi.fn(),
    pump: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe('HistoricalCandleStream', () => {
  const injectExchangeMock = inject.exchange as Mock;
  let stream: HistoricalCandleStream;
  let results: Candle[];
  let isStreamClosed: boolean;

  const launchHistoricalCandleStream = (input: HistoricalCandleStreamInput) => {
    isStreamClosed = false;
    stream = new HistoricalCandleStream(input);
    results = [];
    stream.on('data', data => results.push(data));
    stream.on('end', () => (isStreamClosed = true));
  };

  it('should close the stream if start date is NOT before end date', async () => {
    injectExchangeMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:00:00Z'),
      tickrate: 1000,
    });

    // Wait for any pending data events to be processed.
    await new Promise(resolve => process.nextTick(resolve));

    expect(isStreamClosed).toBeTruthy();
  });

  it('should throw HistoricalCandleError when no candle data is fetched', async () => {
    injectExchangeMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:01:00Z'),
      tickrate: 1000,
    });

    await expect(stream.onTick()).rejects.toThrow(HistoricalCandleError);
  });

  it('should push candles and not end stream when fetched candles do not reach end', async () => {
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    const candle2 = candleFactory('2023-01-01T00:01:0Z', 101);
    injectExchangeMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:02:00Z'),
      tickrate: 1000,
    });

    await stream.onTick();
    // Wait for any pending data events to be processed.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1, candle2]);
  });

  it('should push candles and end stream when fetched candles meet or exceed end', async () => {
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    injectExchangeMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1]),
    });

    launchHistoricalCandleStream({
      startDate: toTimestamp('2023-01-01T00:00:00Z'),
      endDate: toTimestamp('2023-01-01T00:01:00Z'),
      tickrate: 1000,
    });

    await stream.onTick();
    // Wait for pending data events.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1]);
  });
});
