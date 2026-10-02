import { Heart } from '@services/core/heart/heart';
import { info } from '@services/logger';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { inject } from '../../../injecter/injecter';
import { HistoricalCandleError } from './historicalCandle.error';
import { HistoricalCandleStream, HistoricalCandleStreamParams } from './historicalCandle.stream';

const candleFactory = (time: string, value: number) => ({
  id: undefined,
  start: toTimestamp(time),
  open: value,
  high: value,
  low: value,
  close: value,
  volume: 100,
});

vi.mock('@services/logger', () => ({ info: vi.fn() }));
vi.mock('@services/injecter/injecter', () => ({
  inject: { exchange: vi.fn() },
}));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(function () {
    return {
      on: vi.fn(),
      pump: vi.fn(),
      stop: vi.fn(),
    };
  }),
}));

describe('HistoricalCandleStream', () => {
  const injectExchangeMock = inject.exchange as Mock;
  let stream: HistoricalCandleStream;
  let results: { symbol: string; candle: ReturnType<typeof candleFactory> }[];
  let isStreamClosed: boolean;

  // Type used in existing tests
  type TestHistoricalCandleStreamInput = {
    startDate: number;
    endDate: number;
    tickrate: number;
    symbol: string;
  };

  const launchHistoricalCandleStream = (input: TestHistoricalCandleStreamInput) => {
    isStreamClosed = false;

    // Adapt to new HistoricalCandleStreamParams
    const params: HistoricalCandleStreamParams = {
      daterange: {
        start: input.startDate,
        end: input.endDate,
      },
      tickrate: input.tickrate,
      symbol: input.symbol as any, // Cast to TradingPair if needed, strictly it is string vs TradingPair type alias
    };

    stream = new HistoricalCandleStream(params);
    results = [];
    stream.on('data', data => results.push(data));
    stream.on('end', () => (isStreamClosed = true));
  };

  describe('constructor', () => {
    describe('when startDate is after endDate', () => {
      beforeEach(async () => {
        injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

        launchHistoricalCandleStream({
          startDate: toTimestamp('2023-01-02T00:00:00Z'),
          endDate: toTimestamp('2023-01-01T00:00:00Z'),
          tickrate: 1000,
          symbol: 'BTC/USDT',
        });

        await new Promise(resolve => process.nextTick(resolve));
      });

      it('should close stream immediately', () => {
        expect(isStreamClosed).toBeTruthy();
      });

      it('should not start fetching', () => {
        expect(vi.mocked(Heart).mock.results[0].value.pump).not.toHaveBeenCalled();
      });
    });

    // Both bounds are inclusive: equal dates are a one-minute range
    it.each`
      startDate                 | endDate                   | description
      ${'2023-01-01T00:00:00Z'} | ${'2023-01-01T00:00:00Z'} | ${'equal dates'}
      ${'2023-01-01T00:00:00Z'} | ${'2023-01-02T00:00:00Z'} | ${'startDate before endDate'}
    `('should not close stream immediately for $description', async ({ startDate, endDate }) => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp(startDate),
        endDate: toTimestamp(endDate),
        tickrate: 1000,
        symbol: 'ETH/USDT',
      });

      await new Promise(resolve => process.nextTick(resolve));
      expect(isStreamClosed).toBeFalsy();
    });

    it('should log the length of a one-minute range', () => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:00:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      expect(info).toHaveBeenCalledWith(
        'stream',
        '[BTC/USDT] Fetching historical data from 2023-01-01T00:00:00.000Z to 2023-01-01T00:00:00.000Z (1 minute)',
      );
    });
  });

  describe('onTick', () => {
    it('should throw HistoricalCandleError when no candle data is fetched', async () => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:01:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      await expect(stream.onTick()).rejects.toThrow(HistoricalCandleError);
    });

    it('should not execute when already locked', async () => {
      const mockFetchOHLCV = vi
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([candleFactory('2023-01-01T00:00:00Z', 100)]), 20)));
      injectExchangeMock.mockReturnValue({ fetchOHLCV: mockFetchOHLCV });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:01:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      const firstTick = stream.onTick();
      await stream.onTick();
      await firstTick;

      expect(mockFetchOHLCV).toHaveBeenCalledTimes(1);
    });

    it('should push candles and continue when more data is needed', async () => {
      const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
      const candle2 = candleFactory('2023-01-01T00:01:00Z', 101);
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:05:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      await stream.onTick();
      await new Promise(resolve => process.nextTick(resolve));

      expect(results.length).toBe(2);
    });

    it('should end stream when fetched candles reach end date', async () => {
      const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([candle1]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:01:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      await stream.onTick();
      await new Promise(resolve => process.nextTick(resolve));

      expect(results).toEqual([{ symbol: 'BTC/USDT', candle: candle1 }]);
    });

    it('should emit error event when fetch fails', async () => {
      const fetchError = new Error('Network error');
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockRejectedValue(fetchError) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:01:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      const errorPromise = new Promise(resolve => stream.on('error', resolve));
      await stream.onTick();
      const emittedError = await errorPromise;

      expect(emittedError).toBe(fetchError);
    });

    it('should filter candles exceeding endDate when completing', async () => {
      const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
      const candle2 = candleFactory('2023-01-01T00:01:00Z', 101);
      const candle3 = candleFactory('2023-01-01T00:02:00Z', 102);
      injectExchangeMock.mockReturnValue({
        fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2, candle3]),
      });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:01:00Z'),
        tickrate: 1000,
        symbol: 'SOL/USDT',
      });

      await stream.onTick();
      await new Promise(resolve => process.nextTick(resolve));

      expect(results.length).toBe(2);
    });
  });

  describe('with a one-minute range', () => {
    const closedCandle = candleFactory('2023-01-01T00:00:00Z', 100);
    // The exchange also returns the candle still in progress after the requested minute
    const openCandle = candleFactory('2023-01-01T00:01:00Z', 101);

    beforeEach(async () => {
      // A heart that beats as soon as it is pumped
      vi.mocked(Heart).mockImplementation(function () {
        let beat = () => {};
        return { on: (_event: string, listener: () => void) => (beat = listener), pump: () => beat(), stop: vi.fn() } as unknown as Heart;
      });
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([closedCandle, openCandle]) });

      launchHistoricalCandleStream({
        startDate: closedCandle.start,
        endDate: closedCandle.start,
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      await new Promise(resolve => stream.once('end', resolve));
    });

    it('should push exactly the candle of that minute', () => {
      expect(results).toEqual([{ symbol: 'BTC/USDT', candle: closedCandle }]);
    });

    it('should end the stream', () => {
      expect(isStreamClosed).toBeTruthy();
    });
  });

  describe('getStats', () => {
    it.each`
      symbol
      ${'BTC/USDT'}
      ${'ETH/USDT'}
      ${'SOL/USDT'}
    `('should return correct symbol=$symbol with initial count of 0', ({ symbol }) => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:00:00Z'),
        tickrate: 1000,
        symbol,
      });

      expect(stream.getStats()).toEqual({ symbol, count: 0 });
    });

    it('should increment count after each successful fetch', async () => {
      const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
      const candle2 = candleFactory('2023-01-01T00:01:00Z', 101);
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:05:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      await stream.onTick();

      expect(stream.getStats().count).toBe(2);
    });
  });

  describe('pushCandles', () => {
    it('should push all candles from array with correct symbol', async () => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-02T00:00:00Z'),
        tickrate: 1000,
        symbol: 'DOGE/USDT',
      });

      const candle = candleFactory('2023-01-01T00:00:00Z', 100);
      stream.pushCandles([candle]);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(results[results.length - 1]).toEqual({ symbol: 'DOGE/USDT', candle });
    });
  });

  describe('pushCandle', () => {
    it('should push single candle with symbol attached', async () => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-02T00:00:00Z'),
        tickrate: 1000,
        symbol: 'ADA/USDT',
      });

      const candle = candleFactory('2023-01-01T00:00:00Z', 50);
      stream.pushCandle(candle);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(results[0]).toEqual({ symbol: 'ADA/USDT', candle });
    });
  });

  describe('_read', () => {
    it('should be a callable no-op function', () => {
      injectExchangeMock.mockReturnValue({ fetchOHLCV: vi.fn().mockResolvedValue([]) });

      launchHistoricalCandleStream({
        startDate: toTimestamp('2023-01-01T00:00:00Z'),
        endDate: toTimestamp('2023-01-01T00:00:00Z'),
        tickrate: 1000,
        symbol: 'BTC/USDT',
      });

      expect(() => stream._read()).not.toThrow();
    });
  });
});
