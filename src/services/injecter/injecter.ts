import { GekkoError } from '@errors/gekko.error';
import { ExchangeConfig } from '@models/configuration.types';
import { config } from '@services/configuration/configuration';
import { BinanceExchange } from '@services/exchange/centralized/binance/binance';
import { DummyDecentralizedExchange } from '@services/exchange/decentralized/dummy/dummy-decentralized-exchange';
import { DummyCentralizedExchange } from '@services/exchange/centralized/dummy/dummy-centralized-exchange';
import { Exchange } from '@services/exchange/exchange';
import { SQLiteStorage } from '@services/storage/sqlite.storage';
import { Storage } from '@services/storage/storage';

class Injecter {
  private storageInstance?: Storage;
  private exchangeInstance?: Exchange;

  private readonly exchangeFactories: Record<string, new (config: ExchangeConfig) => Exchange> = {
    binance: BinanceExchange,
    'dummy-dex': DummyDecentralizedExchange,
    'dummy-cex': DummyCentralizedExchange,
  };

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
    const ExchangeFactory = this.exchangeFactories[exchangeConfig.name];
    if (!ExchangeFactory) throw new GekkoError('injecter', 'Missing or unknown exchange.');
    this.exchangeInstance = new ExchangeFactory(exchangeConfig);
    return this.exchangeInstance;
  }
}

export const inject = new Injecter();
