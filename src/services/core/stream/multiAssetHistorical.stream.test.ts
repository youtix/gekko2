import { describe, expect, it, vi } from 'vitest';
import { HistoricalCandleStream } from './historicalCandle/historicalCandle.stream';
import { MultiAssetHistoricalStream } from './multiAssetHistorical.stream';

// Mock dependencies
vi.mock('./historicalCandle/historicalCandle.stream', () => ({
  HistoricalCandleStream: vi.fn(),
}));

vi.mock('@utils/stream/stream.utils', () => ({
  synchronizeStreams: vi.fn(() => ({
    on: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
    pipe: vi.fn(),
  })),
}));

describe('MultiAssetHistoricalStream', () => {
  it('should instantiate multiple HistoricalCandleStreams and synchronize them', () => {
    const pairs = [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }] as any;
    const startDate = 1000;
    const endDate = 2000;
    const tickrate = 60;

    new MultiAssetHistoricalStream({ pairs, startDate, endDate, tickrate });

    expect(HistoricalCandleStream).toHaveBeenCalledTimes(2);
    expect(HistoricalCandleStream).toHaveBeenCalledWith({
      startDate,
      endDate,
      tickrate,
      symbol: 'BTC/USDT',
    });
    expect(HistoricalCandleStream).toHaveBeenCalledWith({
      startDate,
      endDate,
      tickrate,
      symbol: 'ETH/USDT',
    });
  });
});
