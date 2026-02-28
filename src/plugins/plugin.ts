import { Timeframe, Watch } from '@models/configuration.types';
import { CandleBucket } from '@models/event.types';
import { Asset, TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { Storage } from '@services/storage/storage';
import { SequentialEventEmitter } from '@utils/event/sequentialEventEmitter';
import { config } from '../services/configuration/configuration';
import { PluginMissingServiceError } from './plugin.error';

export abstract class Plugin extends SequentialEventEmitter {
  private storage?: Storage;
  private exchange?: Exchange;
  protected readonly timeframe: Timeframe;
  protected readonly warmupPeriod: number;
  protected readonly pluginName: string;
  protected readonly strategySettings: unknown;
  protected readonly mode: Watch['mode'];
  protected readonly pairs: TradingPair[];
  protected readonly assets: Asset[];
  protected readonly currency: Asset;

  constructor(pluginName: string) {
    super(pluginName);
    const { timeframe, warmup, mode, pairs, assets, currency } = config.getWatch();

    this.strategySettings = config.getStrategy();

    this.pluginName = pluginName;
    this.timeframe = timeframe;
    this.warmupPeriod = warmup.candleCount;
    this.mode = mode;
    this.pairs = pairs.map(pair => pair.symbol);
    this.assets = assets;
    this.currency = currency;
  }

  /* -------------------------------------------------------------------------- */
  /*                         PLUGIN SERVICE ACCESSORS                           */
  /* -------------------------------------------------------------------------- */

  public setStorage(storage: Storage) {
    this.storage = storage;
  }

  public setExchange(exchange: Exchange) {
    this.exchange = exchange;
  }

  public getStorage() {
    if (!this.storage) throw new PluginMissingServiceError(this.pluginName, 'storage');
    return this.storage;
  }

  public getExchange() {
    if (!this.exchange) throw new PluginMissingServiceError(this.pluginName, 'exchange');
    return this.exchange;
  }

  /* -------------------------------------------------------------------------- */
  /*                         PLUGIN LIFECYCLE HOOKS                             */
  /* -------------------------------------------------------------------------- */

  /** Invoked once immediately after plugin instantiation before any candles are processed. */
  public async processInitStream() {
    await this.processInit();
  }

  /** Executed for every new CandleBucket after it passes through the stream pipeline. */
  public async processInputStream(bucket: CandleBucket) {
    await this.processOneMinuteBucket(bucket);
  }

  /** Invoked once when the stream pipeline terminates. */
  public async processCloseStream() {
    await this.processFinalize();
  }

  protected abstract processInit(): void;
  protected abstract processOneMinuteBucket(bucket: CandleBucket): void;
  protected abstract processFinalize(): void;
}
