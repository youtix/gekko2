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
  // 15 seconds before the next minute boundary
  const now = new Date('2024-01-01T00:00:45.000Z').getTime();
  const previousMinute = new Date('2023-12-31T23:59:00.000Z').getTime();
  const candle: Candle = { start: previousMinute, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };
  const fetchOHLCV = vi.fn();
  let stream: RealtimeStream;

  // The listener the stream registered on its heart's 'tick' event
  const tick = () => heart.on.mock.calls[0][1]();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    (inject.exchange as Mock).mockReturnValue({ fetchOHLCV, getExchangeName: () => 'binance' });
    stream = new RealtimeStream('BTC/USDT');
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
    it('should fetch the last closed candle', async () => {
      fetchOHLCV.mockResolvedValue([candle]);
      await tick();
      expect(fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', { from: previousMinute, limit: 1 });
    });

    it('should push the fetched candle with its symbol', async () => {
      fetchOHLCV.mockResolvedValue([candle]);
      await tick();
      expect(stream.read()).toEqual({ symbol: 'BTC/USDT', candle });
    });

    it('should warn when no candle is fetched', async () => {
      fetchOHLCV.mockResolvedValue([]);
      await tick();
      expect(warning).toHaveBeenCalledWith('stream', 'Received undefined candle');
    });
  });
});
