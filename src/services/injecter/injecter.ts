import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { BinanceExchange } from '@services/exchange/binance/binance';
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
    this.exchangeInstance = new BinanceExchange(exchangeConfig);
    return this.exchangeInstance;
  }
}

export const inject = new Injecter();
