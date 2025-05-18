import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerError } from '../../errors/broker/broker.error';
import { StorageError } from '../../errors/storage/storage.error';
import { config } from '../configuration/configuration';
import { fetcher } from '../fetcher/fetcher.service';
import { inject } from './injecter';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getStorage: vi.fn(), getBroker: vi.fn() }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/sqlite.storage', () => ({
  SQLiteStorage: vi.fn(() => ({})),
}));
vi.mock('@services/broker/generic/generic', () => ({
  GenericBroker: vi.fn(({ name }) => ({ brokerName: name })),
}));

describe('Injecter', () => {
  const getStorageMock = vi.spyOn(config, 'getStorage');
  const getBrokerMock = vi.spyOn(config, 'getBroker');

  beforeEach(() => {
    inject['storageInstance'] = undefined;
    inject['brokerInstance'] = undefined;
    // inject['secondaryBrokerInstance'] = undefined;
  });

  describe('storage', () => {
    it('should cache the storage instance and return the same object on multiple calls', () => {
      getStorageMock.mockReturnValue({ type: 'sqlite', database: '' });
      const first = inject.storage();
      const second = inject.storage();
      expect(second).toBe(first);
    });

    it('should throw StorageError if no config returned', () => {
      getStorageMock.mockReturnValue(undefined);
      expect(() => inject.storage()).toThrow(StorageError);
    });
  });

  describe('broker', () => {
    it('should cache the broker instance and return the same object on multiple calls', () => {
      getBrokerMock.mockReturnValue({ name: 'binance', verbose: false, sandbox: false });
      const first = inject.broker();
      const second = inject.broker();
      expect(second).toBe(first);
    });

    it('should throw BrokerError if no broker config is returned', () => {
      getBrokerMock.mockReturnValue(undefined as unknown as ReturnType<typeof config.getBroker>);
      expect(() => inject.broker()).toThrow(BrokerError);
    });
  });

  describe('fetcher', () => {
    it('should return the global fetcher instance', () => {
      const result = inject.fetcher();
      expect(result).toBe(fetcher);
    });
  });
});
