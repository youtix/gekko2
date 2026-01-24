import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { CCXTExchange } from '@services/exchange/ccxtExchange';
import { DummyCentralizedExchange } from '@services/exchange/dummy/dummyCentralizedExchange';
import { Exchange } from '@services/exchange/exchange.types';
import { PaperTradingBinanceExchange } from '@services/exchange/paper/paperTradingBinanceExchange';
import { SQLiteStorage } from '@services/storage/sqlite.storage';
import { Storage } from '@services/storage/storage';

class Injecter {
  private storageInstance?: Storage;
  private exchangeInstance?: Exchange;

  public storage() {
    if (this.storageInstance) return this.storageInstance;
    const storageConfig = config.getStorage();
    if (!storageConfig?.type) throw new GekkoError('injecter', 'Missing or unknown storage.');
    const { pairs } = config.getWatch();
    this.storageInstance = new SQLiteStorage(pairs.map(({ symbol }) => symbol));
    return this.storageInstance;
  }

  public exchange() {
    if (this.exchangeInstance) return this.exchangeInstance;
    const exchangeConfig = config.getExchange();
    if (!exchangeConfig?.name) throw new GekkoError('injecter', 'Missing or unknown exchange.');
    switch (exchangeConfig.name) {
      case 'binance':
      case 'hyperliquid':
        this.exchangeInstance = new CCXTExchange(exchangeConfig);
        break;
      case 'dummy-cex':
        this.exchangeInstance = new DummyCentralizedExchange(exchangeConfig);
        break;
      case 'paper-binance':
        this.exchangeInstance = new PaperTradingBinanceExchange(exchangeConfig);
        break;
      default:
        throw new GekkoError('injecter', 'Missing or unknown exchange.');
    }
    return this.exchangeInstance;
  }
}

export const inject = new Injecter();
