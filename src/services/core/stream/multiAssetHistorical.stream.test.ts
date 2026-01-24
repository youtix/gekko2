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
    const pairs = [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }] as any; // keeping as any for simplicity if strict types aren't easily mockable here without more imports
    const daterange = { start: 1000, end: 2000 };
    const tickrate = 60;

    new MultiAssetHistoricalStream({ pairs, daterange, tickrate });

    expect(HistoricalCandleStream).toHaveBeenCalledTimes(2);
    expect(HistoricalCandleStream).toHaveBeenCalledWith({
      daterange,
      tickrate,
      symbol: 'BTC/USDT',
    });
    expect(HistoricalCandleStream).toHaveBeenCalledWith({
      daterange,
      tickrate,
      symbol: 'ETH/USDT',
    });
  });
});
