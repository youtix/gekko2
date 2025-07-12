import { GekkoError } from '@errors/gekko.error';
import { Broker } from '@services/broker/broker';
import { GenericBroker } from '@services/broker/generic/generic';
import { config } from '@services/configuration/configuration';
import { SQLiteStorage } from '@services/storage/sqlite.storage';
import { Storage } from '@services/storage/storage';

class Injecter {
  private storageInstance?: Storage;
  private brokerInstance?: Broker;

  public storage() {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (!storageConfig?.type) throw new GekkoError('injecter', 'Missing or unknown storage.');
    this.storageInstance = new SQLiteStorage();
    return this.storageInstance;
  }

  public broker() {
    if (this.brokerInstance) return this.brokerInstance;
    const brokerConfig = config.getBroker();
    if (!brokerConfig?.name) throw new GekkoError('injecter', 'Missing or unknown broker.');
    this.brokerInstance = new GenericBroker(brokerConfig);
    return this.brokerInstance;
  }
}

export const inject = new Injecter();
