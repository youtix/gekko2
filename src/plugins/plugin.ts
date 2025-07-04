import { Watch } from '@models/types/configuration.types';
import { Broker } from '@services/broker/broker';
import { Fetcher } from '@services/fetcher/fetcher.types';
import { Fs } from '@services/fs/fs.types';
import { Storage } from '@services/storage/storage';
import EventEmitter from 'node:events';
import { Candle } from '../models/types/candle.types';
import { DeffferedEvent } from '../models/types/event.types';
import { config } from '../services/configuration/configuration';
import { PluginMissingServiceError } from './plugin.error';

export abstract class Plugin extends EventEmitter {
  private defferedEvents: DeffferedEvent[];
  private storage?: Storage;
  private broker?: Broker;
  private fetcher?: Fetcher;
  private fs?: Fs;

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
    this.warmupPeriod = warmup?.candleCount;
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN SERVICE ACCESSORS
  // --------------------------------------------------------------------------

  public setStorage(storage: Storage) {
    this.storage = storage;
  }

  public setBroker(broker: Broker) {
    this.broker = broker;
  }

  public setFetcher(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  public setFs(fs: Fs) {
    this.fs = fs;
  }

  public getStorage() {
    if (!this.storage) throw new PluginMissingServiceError(this.pluginName, 'storage');
    return this.storage;
  }

  public getBroker() {
    if (!this.broker) throw new PluginMissingServiceError(this.pluginName, 'broker');
    return this.broker;
  }

  public getFetcher() {
    if (!this.fetcher) throw new PluginMissingServiceError(this.pluginName, 'fetcher');
    return this.fetcher;
  }

  public getFs() {
    if (!this.fs) throw new PluginMissingServiceError(this.pluginName, 'fs');
    return this.fs;
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
