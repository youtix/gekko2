import { Candle } from '@models/candle.types';
import { inject } from '@services/injecter/injecter';
import { warning } from '@services/logger';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { RealtimeStream } from './realtime.stream';

const { heart } = vi.hoisted(() => ({ heart: { on: vi.fn(), pump: vi.fn(), stop: vi.fn() } }));

vi.mock('@services/logger', () => ({ debug: vi.fn(), warning: vi.fn() }));
vi.mock('@services/injecter/injecter', () => ({ inject: { exchange: vi.fn() } }));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(function () {
    return heart;
  }),
}));

describe('RealtimeStream', () => {
  const at = (iso: string) => new Date(iso).getTime();
  // Built 15 seconds before the end of the minute it starts with
  const startMinute = at('2024-01-01T00:00:00.000Z');
  const now = at('2024-01-01T00:00:45.000Z');
  const candleAt = (start: EpochTimeStamp): Candle => ({ start, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 });
  const fetchOHLCV = vi.fn();
  let stream: RealtimeStream;

  // Fires, at the given time, the listener that the nth stream built registered on its heart's 'tick' event
  const tickAt = (iso: string, nth = 0): Promise<void> => {
    vi.setSystemTime(at(iso));
    return heart.on.mock.calls[nth][1]();
  };
  // The minutes asked from the exchange, in order
  const fetchedMinutes = () => fetchOHLCV.mock.calls.map(([, { from }]) => new Date(from).toISOString());

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    fetchOHLCV.mockImplementation(async (_symbol: string, { from }: { from: EpochTimeStamp }) => [candleAt(from)]);
    (inject.exchange as Mock).mockReturnValue({ fetchOHLCV, getExchangeName: () => 'binance' });
    stream = new RealtimeStream('BTC/USDT', startMinute);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('heart start', () => {
    it.each`
      elapsed   | calls
      ${14_999} | ${0}
      ${15_000} | ${1}
    `('should pump the heart at the next minute boundary, not before (after $elapsed ms)', ({ elapsed, calls }) => {
      vi.advanceTimersByTime(elapsed);
      expect(heart.pump).toHaveBeenCalledTimes(calls);
    });

    it('should never pump the heart when destroyed before its first tick', () => {
      stream.destroy();
      vi.runAllTimers();
      expect(heart.pump).not.toHaveBeenCalled();
    });
  });

  describe('_destroy', () => {
    it('should stop the heart', () => {
      stream.destroy();
      expect(heart.stop).toHaveBeenCalled();
    });
  });

  describe('on heart tick', () => {
    it.each`
      clock                         | minutes
      ${'2024-01-01T00:00:59.999Z'} | ${[]}
      ${'2024-01-01T00:01:00.000Z'} | ${['2024-01-01T00:00:00.000Z']}
      ${'2024-01-01T00:01:59.999Z'} | ${['2024-01-01T00:00:00.000Z']}
      ${'2024-01-01T00:03:00.000Z'} | ${['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z', '2024-01-01T00:02:00.000Z']}
    `('should fetch the minutes closed from the start minute on, oldest first, on a first tick at $clock', async ({ clock, minutes }) => {
      await tickAt(clock);
      expect(fetchedMinutes()).toEqual(minutes);
    });

    it('should ask the exchange for the candle of the minute alone', async () => {
      await tickAt('2024-01-01T00:01:00.000Z');
      expect(fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', { from: startMinute, limit: 1 });
    });

    // Twice in a minute, on time, early then on time, on time then late by a minute
    it.each`
      clocks                                                      | minutes
      ${['2024-01-01T00:01:00.000Z', '2024-01-01T00:01:30.000Z']} | ${['2024-01-01T00:00:00.000Z']}
      ${['2024-01-01T00:01:00.000Z', '2024-01-01T00:02:00.000Z']} | ${['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z']}
      ${['2024-01-01T00:00:59.999Z', '2024-01-01T00:02:00.000Z']} | ${['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z']}
      ${['2024-01-01T00:01:00.000Z', '2024-01-01T00:03:00.001Z']} | ${['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z', '2024-01-01T00:02:00.000Z']}
    `('should fetch each minute once, in order, when the heart ticks at $clocks', async ({ clocks, minutes }) => {
      for (const clock of clocks) await tickAt(clock);
      expect(fetchedMinutes()).toEqual(minutes);
    });

    it('should fetch the same minutes as the stream of another pair started on the same minute, whose tick falls past the next boundary', async () => {
      new RealtimeStream('ETH/USDT', startMinute);
      await tickAt('2024-01-01T00:01:00.001Z', 0);
      await tickAt('2024-01-01T00:02:00.001Z', 1);
      expect(fetchOHLCV.mock.calls.map(([symbol, { from }]) => `${symbol} ${new Date(from).toISOString()}`)).toEqual([
        'BTC/USDT 2024-01-01T00:00:00.000Z',
        'ETH/USDT 2024-01-01T00:00:00.000Z',
        'ETH/USDT 2024-01-01T00:01:00.000Z',
      ]);
    });

    it('should push the fetched candles with their symbol, oldest first', async () => {
      await tickAt('2024-01-01T00:02:00.000Z');
      expect([stream.read(), stream.read()]).toEqual([
        { symbol: 'BTC/USDT', candle: candleAt(at('2024-01-01T00:00:00.000Z')) },
        { symbol: 'BTC/USDT', candle: candleAt(at('2024-01-01T00:01:00.000Z')) },
      ]);
    });

    it('should warn when no candle is fetched', async () => {
      fetchOHLCV.mockResolvedValue([]);
      await tickAt('2024-01-01T00:01:00.000Z');
      expect(warning).toHaveBeenCalledWith('stream', 'Received undefined candle');
    });

    it('should not fetch again a minute whose fetch failed', async () => {
      fetchOHLCV.mockRejectedValueOnce(new Error('Network error'));
      await tickAt('2024-01-01T00:01:00.000Z').catch(() => {});
      await tickAt('2024-01-01T00:02:00.000Z');
      expect(fetchedMinutes()).toEqual(['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z']);
    });

    describe('when the heart ticks while a fetch is in progress', () => {
      let resolveFetch: (candles: Candle[]) => void;
      let firstTick: Promise<void>;

      beforeEach(async () => {
        fetchOHLCV.mockImplementationOnce(() => new Promise(resolve => (resolveFetch = resolve)));
        firstTick = tickAt('2024-01-01T00:01:00.000Z');
        await tickAt('2024-01-01T00:02:00.000Z');
      });

      it('should leave the minutes to that fetch', () => {
        expect(fetchedMinutes()).toEqual(['2024-01-01T00:00:00.000Z']);
      });

      it('should fetch the minutes closed meanwhile once that fetch is done, in order', async () => {
        resolveFetch([candleAt(startMinute)]);
        await firstTick;
        expect(fetchedMinutes()).toEqual(['2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z']);
      });

      it('should fetch nothing more once the stream is destroyed', async () => {
        stream.destroy();
        resolveFetch([candleAt(startMinute)]);
        await firstTick;
        expect(fetchedMinutes()).toEqual(['2024-01-01T00:00:00.000Z']);
      });
    });
  });
});
