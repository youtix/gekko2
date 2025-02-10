import { UnknownBrokerError } from '@errors/broker/unknownBroker.error';
import { BinanceBroker } from '@services/broker/binance/binance';
import { Broker } from '@services/broker/broker';
import { config } from '@services/configuration/configuration';
import { SQLiteStorage } from './sqlite.storage';
import { Storage } from './storage';

class Injecter {
  private storageInstance?: Storage;
  private brokerInstance?: Broker;

  public storage(): Storage {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (storageConfig?.type === 'sqlite') return new SQLiteStorage();
    throw new Error(); // TODO
  }

  public broker(): Broker {
    if (this.brokerInstance) return this.brokerInstance;
    const brokerConfig = config.getBroker();
    if (brokerConfig?.name === 'binance') return new BinanceBroker(brokerConfig);
    throw new UnknownBrokerError(brokerConfig?.name ?? '');
  }
}

export const inject = new Injecter();
