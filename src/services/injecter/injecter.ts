import { BrokerError } from '@errors/broker/broker.error';
import { StorageError } from '@errors/storage/storage.error';
import { Broker } from '@services/broker/broker';
import { GenericBroker } from '@services/broker/generic/generic';
import { config } from '@services/configuration/configuration';
import { fetcher } from '@services/fetcher/fetcher.service';
import { lockSync } from '@services/fs/fs.service';
import { SQLiteStorage } from '@services/storage/sqlite.storage';
import { Storage } from '@services/storage/storage';

class Injecter {
  private storageInstance?: Storage;
  private brokerInstance?: Broker;

  public storage() {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (!storageConfig?.type) throw new StorageError('Missing or unknown storage.');
    this.storageInstance = new SQLiteStorage();
    return this.storageInstance;
  }

  public broker() {
    if (this.brokerInstance) return this.brokerInstance;
    const brokerConfig = config.getBroker();
    if (!brokerConfig?.name) throw new BrokerError('Missing or unknown broker.');
    this.brokerInstance = new GenericBroker(brokerConfig);
    return this.brokerInstance;
  }

  public fetcher() {
    return fetcher;
  }

  public fs() {
    return { lockSync };
  }
}

export const inject = new Injecter();
