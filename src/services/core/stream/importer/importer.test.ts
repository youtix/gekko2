import { describe, expect, it, Mock, vi } from 'vitest';
import { ImporterError } from '../../../../errors/importer.error';
import { Candle } from '../../../../models/types/candle.types';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { config } from '../../../configuration/configuration';
import { inject } from '../../../storage/injecter/injecter';
import { ImporterStream } from './importer.stream';

function candleFactory(time: string, value: number) {
  return {
    start: toTimestamp(time),
    open: value,
    high: value,
    low: value,
    close: value,
  };
}

vi.mock('@services/logger', () => ({ logger: { info: vi.fn() } }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({
      daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-01T00:00:05Z' },
    })),
  }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/injecter/injecter', () => ({
  inject: { broker: vi.fn() },
}));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(() => ({
    on: vi.fn(),
    pump: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe('ImporterStream', () => {
  const getWatchMock = config.getWatch as Mock;
  const injectBrokerMock = inject.broker as Mock;
  let stream: ImporterStream;
  let results: Candle[];

  const resetImporteStream = () => {
    stream = new ImporterStream();
    results = [];
    stream.on('data', data => results.push(data));
  };

  it('should throw ImporterError when no candle data is fetched', async () => {
    getWatchMock.mockReturnValue({
      daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-01T00:00:05Z' },
    });
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([]),
    });

    resetImporteStream();

    await expect(stream.onTick()).rejects.toThrow(ImporterError);
  });

  it('should push candles and not end stream when fetched candles do not reach end', async () => {
    getWatchMock.mockReturnValue({
      daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-01T00:00:05Z' },
    });
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    const candle2 = candleFactory('2023-01-01T00:00:01Z', 101);
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1, candle2]),
    });

    resetImporteStream();

    await stream.onTick();
    // Wait for any pending data events to be processed.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1, candle2]);
  });

  it('should push candles and end stream when fetched candles meet or exceed end', async () => {
    getWatchMock.mockReturnValue({
      daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-01T00:00:01Z' },
    });
    const candle1 = candleFactory('2023-01-01T00:00:00Z', 100);
    injectBrokerMock.mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([candle1]),
    });

    resetImporteStream();

    await stream.onTick();
    // Wait for pending data events.
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle1]);
  });
});
