import { PluginMissingServiceError } from '@errors/plugin/pluginMissingService.error';
import { Broker } from '@services/broker/broker';
import { Fetcher } from '@services/fetcher/fetcher.types';
import { Storage } from '@services/storage/storage';
import { drop, first } from 'lodash-es';
import EventEmitter from 'node:events';
import { Candle } from '../models/types/candle.types';
import { DeffferedEvent } from '../models/types/event.types';
import { config } from '../services/configuration/configuration';

export abstract class Plugin extends EventEmitter {
  private defferedEvents: DeffferedEvent[];
  private storage?: Storage;
  private broker?: Broker;
  private fetcher?: Fetcher;

  protected asset: string;
  protected currency: string;
  protected pluginName: string;

  constructor(pluginName: string) {
    super();
    const { asset, currency } = config.getWatch();

    this.defferedEvents = [];
    this.pluginName = pluginName;
    this.asset = asset;
    this.currency = currency;
  }

  public setStorage(storage: Storage) {
    this.storage = storage;
  }

  public setBroker(broker: Broker) {
    this.broker = broker;
  }

  public setFetcher(fetcher: Fetcher) {
    this.fetcher = fetcher;
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

  /** To call in Gekko stream */
  public async processInputStream(candle: Candle, done: () => void) {
    await this.processCandle(candle);
    done();
  }

  /** To call in Gekko stream */
  public async processCloseStream(done?: () => void) {
    await this.processFinalize();
    done?.();
  }

  /** To call in Gekko stream */
  public broadcastDeferredEmit() {
    const event = first(this.defferedEvents);
    if (!event) return false;
    this.defferedEvents = drop(this.defferedEvents);
    this.emit(event.name, event.payload);
    return true;
  }

  protected deferredEmit<T = unknown>(name: string, payload: T) {
    this.defferedEvents = [...this.defferedEvents, { name, payload }];
  }

  protected abstract processCandle(candle: Candle): void;
  protected abstract processFinalize(): void;
}
