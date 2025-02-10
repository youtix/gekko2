import { BrokerError } from '@errors/broker/broker.error';
import { StorageError } from '@errors/storage/storage.error';
import { BinanceBroker } from '@services/broker/binance/binance';
import { Broker } from '@services/broker/broker';
import { config } from '@services/configuration/configuration';
import { fetcher } from '@services/fetcher/fetcher.service';
import { SQLiteStorage } from './sqlite.storage';
import { Storage } from './storage';

class Injecter {
  private storageInstance?: Storage;
  private brokerInstance?: Broker;

  public storage() {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (storageConfig?.type === 'sqlite') {
      this.storageInstance = new SQLiteStorage();
      return this.storageInstance;
    }
    throw new StorageError(`Unknown ${storageConfig?.type} storage type`);
  }

  public broker() {
    if (this.brokerInstance) return this.brokerInstance;
    const brokerConfig = config.getBroker();
    if (brokerConfig?.name === 'binance') {
      this.brokerInstance = new BinanceBroker(brokerConfig);
      return this.brokerInstance;
    }
    throw new BrokerError(`Unknown ${brokerConfig?.name} broker.`);
  }

  public fetcher() {
    return fetcher;
  }
}

export const inject = new Injecter();
