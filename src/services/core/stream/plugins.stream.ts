import { StopGekkoError } from '@errors/stopGekko.error';
import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { after, find } from 'lodash-es';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  plugins: Plugin[];
  private hasClosed = false;
  private readonly dummyExchange?: DummyExchange;

  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
    const exchange = inject.exchange();
    if (isDummyExchange(exchange)) this.dummyExchange = exchange;
  }

  public async _write(chunk: Candle, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    const flushEvents = this.flushEvents().bind(this);
    try {
      // Forward candle to dummy exchange (if set by user) before all plugins
      this.dummyExchange?.addCandle(chunk);
      // Forward candle to all plugins
      for (const plugin of this.plugins) await plugin.processInputStream(chunk, flushEvents);
      done();
    } catch (error) {
      if (error instanceof StopGekkoError) {
        try {
          await this.closePlugins();
        } catch (closeError) {
          done(closeError as Error);
          return;
        }
        done(error);
        return;
      }
      done(error as Error);
    }
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    try {
      await this.closePlugins();
      done();
    } catch (error) {
      if (error instanceof Error) done(error);
    }
  }

  private flushEvents() {
    return after(this.plugins.length, () => {
      this.broadcastAllDeferredEvents();
    });
  }

  private broadcastAllDeferredEvents() {
    while (find(this.plugins, p => p.broadcastDeferredEmit())) {
      // continue looping while at least one plugin emitted an event
    }
  }

  private async closePlugins() {
    if (this.hasClosed) return;
    this.hasClosed = true;
    for (const plugin of this.plugins) await plugin.processCloseStream();
    info('stream', 'Gekko is closing the application !');
  }
}
