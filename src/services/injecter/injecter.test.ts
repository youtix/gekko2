import { GekkoError } from '@errors/gekko.error';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../configuration/configuration';
import { inject } from './injecter';

const { BinanceExchangeMock, DummyExchangeMock } = vi.hoisted(() => ({
  BinanceExchangeMock: vi.fn(({ name }) => ({ exchangeName: name, type: 'binance' })),
  DummyExchangeMock: vi.fn(({ name }) => ({ exchangeName: name, type: 'dummy' })),
}));

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getStorage: vi.fn(), getExchange: vi.fn() }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/sqlite.storage', () => ({
  SQLiteStorage: vi.fn(() => ({})),
}));
vi.mock('@services/exchange/centralized/binance/binance', () => ({
  BinanceExchange: BinanceExchangeMock,
}));
vi.mock('@services/exchange/decentralized/dummy/dummy', () => ({
  DummyExchange: DummyExchangeMock,
}));

describe('Injecter', () => {
  const getStorageMock = vi.spyOn(config, 'getStorage');
  const getExchangeMock = vi.spyOn(config, 'getExchange');

  beforeEach(() => {
    inject['storageInstance'] = undefined;
    inject['exchangeInstance'] = undefined;
    BinanceExchangeMock.mockClear();
    DummyExchangeMock.mockClear();
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
      expect(BinanceExchangeMock).toHaveBeenCalledTimes(1);
      expect(BinanceExchangeMock).toHaveBeenCalledWith({ name: 'binance', verbose: false, sandbox: false });
    });

    it('should throw GekkoError if no exchange config is returned', () => {
      getExchangeMock.mockReturnValue(undefined as unknown as ReturnType<typeof config.getExchange>);
      expect(() => inject.exchange()).toThrow(GekkoError);
    });

    it('should instantiate dummy exchange when requested', () => {
      getExchangeMock.mockReturnValue({ name: 'dummy-dex', verbose: false, sandbox: false });
      const exchange = inject.exchange();
      expect(exchange).toMatchObject({ exchangeName: 'dummy-dex', type: 'dummy' });
      expect(DummyExchangeMock).toHaveBeenCalledTimes(1);
      expect(DummyExchangeMock).toHaveBeenCalledWith({ name: 'dummy-dex', verbose: false, sandbox: false });
    });
  });
});
