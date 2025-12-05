import { GekkoError } from '@errors/gekko.error';
import { Watch } from '@models/configuration.types';
import { DummyCentralizedExchangeConfig } from '@services/exchange/dummy/dummyCentralizedExchange.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../configuration/configuration';
import { inject } from './injecter';

const { BinanceExchangeMock, DummyCentralizedExchangeMock } = vi.hoisted(() => ({
  BinanceExchangeMock: vi.fn(function () {
    return { exchangeName: 'binance', type: 'binance' };
  }),
  DummyCentralizedExchangeMock: vi.fn(function ({ name }) {
    return { exchangeName: name, type: 'dummy-cex' };
  }),
}));

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return { getStorage: vi.fn(), getExchange: vi.fn(), getWatch: vi.fn() };
  });
  return { config: new Configuration() };
});
vi.mock('@services/storage/sqlite.storage', () => ({
  SQLiteStorage: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@services/exchange/ccxtExchange', () => ({
  CCXTExchange: BinanceExchangeMock,
}));
vi.mock('@services/exchange/dummy/dummyCentralizedExchange', () => ({
  DummyCentralizedExchange: DummyCentralizedExchangeMock,
}));

describe('Injecter', () => {
  const getStorageMock = vi.spyOn(config, 'getStorage');
  const getExchangeMock = vi.spyOn(config, 'getExchange');
  const getWatchMock = vi.spyOn(config, 'getWatch');

  beforeEach(() => {
    inject['storageInstance'] = undefined;
    inject['exchangeInstance'] = undefined;
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
      const binanceConfig = { name: 'binance', verbose: false, sandbox: false, interval: 1000 };
      getExchangeMock.mockReturnValue(binanceConfig as unknown as DummyCentralizedExchangeConfig);
      const first = inject.exchange();
      const second = inject.exchange();
      expect(second).toBe(first);
      expect(BinanceExchangeMock).toHaveBeenCalledTimes(1);
      expect(BinanceExchangeMock).toHaveBeenCalledWith();
    });

    it('should throw GekkoError if no exchange config is returned', () => {
      getExchangeMock.mockReturnValue(undefined as unknown as DummyCentralizedExchangeConfig);
      expect(() => inject.exchange()).toThrow(GekkoError);
    });

    it('should instantiate dummy centralized exchange when requested', () => {
      const dummyConfig = {
        name: 'dummy-cex',
        verbose: false,
        sandbox: false,
        feeMaker: 0.15,
        feeTaker: 0.25,
        simulationBalance: { asset: 0, currency: 0 },
      };
      getExchangeMock.mockReturnValue(dummyConfig as unknown as DummyCentralizedExchangeConfig);
      getWatchMock.mockReturnValue({ asset: 'BTC', currency: 'USDT' } as Watch);
      const exchange = inject.exchange();

      expect(exchange).toMatchObject({ exchangeName: 'dummy-cex' });
      expect(DummyCentralizedExchangeMock).toHaveBeenCalledTimes(1);
      expect(DummyCentralizedExchangeMock).toHaveBeenCalledWith(dummyConfig);
    });
  });
});
