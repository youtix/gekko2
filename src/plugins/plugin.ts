import { Watch } from '@models/configuration.types';
import { Exchange } from '@services/exchange/exchange';
import { Storage } from '@services/storage/storage';
import EventEmitter from 'node:events';
import { Candle } from '../models/candle.types';
import { DeffferedEvent } from '../models/event.types';
import { config } from '../services/configuration/configuration';
import { PluginMissingServiceError } from './plugin.error';

export abstract class Plugin extends EventEmitter {
  private defferedEvents: DeffferedEvent[];
  private storage?: Storage;
  private exchange?: Exchange;

  protected asset: string;
  protected currency: string;
  protected timeframe: Watch['timeframe'];
  protected warmupPeriod: number;
  protected pluginName: string;
  protected strategySettings: unknown;

  constructor(pluginName: string) {
    super();
    const { asset, currency, timeframe, warmup } = config.getWatch();
    this.strategySettings = config.getStrategy();

    this.defferedEvents = [];
    this.pluginName = pluginName;
    this.asset = asset;
    this.currency = currency;
    this.timeframe = timeframe;
    this.warmupPeriod = warmup.candleCount;
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN SERVICE ACCESSORS
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  /** Invoked once immediately after plugin instantiation before any candles are processed. */
  public async processInitStream() {
    await this.processInit();
  }

  /** Executed for every new candle after it passes through the stream pipeline.  */
  public async processInputStream(candle: Candle, done: () => void) {
    await this.processOneMinuteCandle(candle);
    done();
  }

  /** Invoked once when the stream pipeline terminates. */
  public async processCloseStream() {
    await this.processFinalize();
  }

  /** Emits deferred event, invoked in loop after each candle has been handled by all plugins. */
  public broadcastDeferredEmit() {
    const event = this.defferedEvents.shift();
    if (!event) return false;
    this.emit(event.name, event.payload);
    return true;
  }

  protected deferredEmit<T = unknown>(name: string, payload: T) {
    this.defferedEvents.push({ name, payload });
  }

  protected abstract processInit(): void;
  protected abstract processOneMinuteCandle(oneMinCandle: Candle): void;
  protected abstract processFinalize(): void;
}
