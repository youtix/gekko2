import { GekkoError } from '@errors/gekko.error';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../configuration/configuration';
import { inject } from './injecter';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getStorage: vi.fn(), getExchange: vi.fn() }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/sqlite.storage', () => ({
  SQLiteStorage: vi.fn(() => ({})),
}));
vi.mock('@services/exchange/binance/binance', () => ({
  BinanceExchange: vi.fn(({ name }) => ({ exchangeName: name })),
}));

describe('Injecter', () => {
  const getStorageMock = vi.spyOn(config, 'getStorage');
  const getExchangeMock = vi.spyOn(config, 'getExchange');

  beforeEach(() => {
    inject['storageInstance'] = undefined;
    inject['exchangeInstance'] = undefined;
    // inject['secondaryExchangeInstance'] = undefined;
  });

  describe('storage', () => {
    it('should cache the storage instance and return the same object on multiple calls', () => {
      getStorageMock.mockReturnValue({ type: 'sqlite', database: '' });
      const first = inject.storage();
      const second = inject.storage();
      expect(second).toBe(first);
    });

    it('should throw GekkoError if no config returned', () => {
      getStorageMock.mockReturnValue(undefined);
      expect(() => inject.storage()).toThrow(GekkoError);
    });
  });

  describe('exchange', () => {
    it('should cache the exchange instance and return the same object on multiple calls', () => {
      getExchangeMock.mockReturnValue({ name: 'binance', verbose: false, sandbox: false });
      const first = inject.exchange();
      const second = inject.exchange();
      expect(second).toBe(first);
    });

    it('should throw GekkoError if no exchange config is returned', () => {
      getExchangeMock.mockReturnValue(undefined as unknown as ReturnType<typeof config.getExchange>);
      expect(() => inject.exchange()).toThrow(GekkoError);
    });
  });
});
