import { Timeframe, Watch } from '@models/configuration.types';
import { TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { Storage } from '@services/storage/storage';
import { SequentialEventEmitter } from '@utils/event/sequentialEventEmitter';
import { Candle } from '../models/candle.types';
import { config } from '../services/configuration/configuration';
import { PluginMissingServiceError } from './plugin.error';

export abstract class Plugin extends SequentialEventEmitter {
  private storage?: Storage;
  private exchange?: Exchange;
  protected readonly asset: string;
  protected readonly currency: string;
  protected readonly symbol: TradingPair;
  protected readonly timeframe: Timeframe;
  protected readonly warmupPeriod: number;
  protected readonly pluginName: string;
  protected readonly strategySettings: unknown;
  protected readonly mode: Watch['mode'];

  constructor(pluginName: string) {
    super(pluginName);
    const { pairs, timeframe, warmup, mode } = config.getWatch();
    const { symbol } = pairs[0]; // TODO: support multiple pairs
    const [asset, currency] = symbol.split('/');

    this.strategySettings = config.getStrategy();

    this.pluginName = pluginName;
    this.symbol = symbol;
    this.asset = asset;
    this.currency = currency;
    this.timeframe = timeframe;
    this.warmupPeriod = warmup.candleCount;
    this.mode = mode;
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

  /** Executed for every new candle after it passes through the stream pipeline.  */
  public async processInputStream(candle: Candle) {
    await this.processOneMinuteCandle(candle);
  }

  /** Invoked once when the stream pipeline terminates. */
  public async processCloseStream() {
    await this.processFinalize();
  }

  protected abstract processInit(): void;
  protected abstract processOneMinuteCandle(oneMinCandle: Candle): void;
  protected abstract processFinalize(): void;
}
