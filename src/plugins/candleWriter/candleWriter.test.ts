import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandleWriter } from './candleWriter';
import { candleWriterSchema } from './candleWriter.schema';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({ warmup: {} })),
      getStrategy: vi.fn(() => ({})),
      showLogo: vi.fn(),
      getPlugins: vi.fn(),
      getStorage: vi.fn(),
      getExchange: vi.fn(),
    };
  });
  return { config: new Configuration() };
});

describe('CandleWriter', () => {
  let writer: CandleWriter;
  let fakeStorage: Storage;
  beforeEach(() => {
    const config = { name: 'CandleWriter' };
    writer = new CandleWriter(config);
    fakeStorage = { addCandle: vi.fn(), insertCandles: vi.fn(), close: vi.fn() } as unknown as Storage;
    // @ts-expect-error Force casting to storage
    writer.getStorage = (): Storage => fakeStorage;
  });

  describe('constructor', () => {
    it('should create an instance with the given name', () => {
      expect(writer['pluginName']).toBe('CandleWriter');
    });
  });

  describe('processOneMinuteCandle', () => {
    it('should add a candle to the storage', () => {
      const candle = {
        open: 100,
        close: 105,
        high: 110,
        low: 95,
        volume: 1000,
        start: 1620000000000,
      };
      writer['processOneMinuteCandle'](candle);
      expect(fakeStorage.addCandle).toHaveBeenCalledWith(candle);
    });
  });

  describe('processFinalize', () => {
    it('should call insertCandles on the storage', () => {
      writer['processFinalize']();
      expect(fakeStorage.insertCandles).toHaveBeenCalled();
    });

    it('should call close on the storage', () => {
      writer['processFinalize']();
      expect(fakeStorage.close).toHaveBeenCalled();
    });
  });

  describe('getStaticConfiguration', () => {
    const config = CandleWriter.getStaticConfiguration();

    it('should return the correct schema', () => {
      expect(config.schema).toBe(candleWriterSchema);
    });

    it('should return modes equal to ["realtime", "importer"]', () => {
      expect(config.modes).toEqual(['realtime', 'importer']);
    });

    it('should return dependencies as an empty array', () => {
      expect(config.dependencies).toEqual([]);
    });

    it('should return inject equal to ["storage"]', () => {
      expect(config.inject).toEqual(['storage']);
    });

    it('should return eventsHandlers as an empty array', () => {
      expect(config.eventsHandlers).toEqual([]);
    });

    it('should return eventsEmitted as an empty array', () => {
      expect(config.eventsEmitted).toEqual([]);
    });

    it('should return name equal to CandleWriter.name', () => {
      expect(config.name).toBe(CandleWriter.name);
    });
  });
});
