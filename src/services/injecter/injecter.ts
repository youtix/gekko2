import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { BinanceExchange } from '@services/exchange/centralized/binance/binance';
import { DummyCentralizedExchange } from '@services/exchange/centralized/dummy/dummyCentralizedExchange';
import { Exchange } from '@services/exchange/exchange';
import { SQLiteStorage } from '@services/storage/sqlite.storage';
import { Storage } from '@services/storage/storage';

class Injecter {
  private storageInstance?: Storage;
  private exchangeInstance?: Exchange;

  public storage() {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (!storageConfig?.type) throw new GekkoError('injecter', 'Missing or unknown storage.');
    this.storageInstance = new SQLiteStorage();
    return this.storageInstance;
  }

  public exchange() {
    if (this.exchangeInstance) return this.exchangeInstance;
    const exchangeConfig = config.getExchange();
    if (!exchangeConfig?.name) throw new GekkoError('injecter', 'Missing or unknown exchange.');
    switch (exchangeConfig.name) {
      case 'binance':
        this.exchangeInstance = new BinanceExchange();
        break;
      case 'dummy-cex':
        this.exchangeInstance = new DummyCentralizedExchange(exchangeConfig);
        break;
      default:
        throw new GekkoError('injecter', 'Missing or unknown exchange.');
    }
    return this.exchangeInstance;
  }
}

export const inject = new Injecter();
