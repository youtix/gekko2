import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  private readonly plugins: Plugin[];
  private readonly dummyExchange?: DummyExchange;

  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
    const exchange = inject.exchange();
    if (isDummyExchange(exchange)) this.dummyExchange = exchange;
  }

  public async _construct(callback: (error?: Error | null) => void): Promise<void> {
    try {
      for (const plugin of this.plugins) await plugin.processInitStream();
      callback();
    } catch (error) {
      if (error instanceof Error) callback(error);
      else callback(new Error(`Error when initializing stream plugin: ${error}`));
    }
  }

  public async _write(candle: Candle, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    try {
      // Forward candle to dummy exchange (if set by user) before all plugins
      await this.dummyExchange?.processOneMinuteCandle(candle);

      // Forward candle to all plugins concurrently
      await Promise.all(this.plugins.map(plugin => plugin.processInputStream(candle)));

      // Broadcast all deferred events sequentially
      for (const plugin of this.plugins) {
        while (await plugin.broadcastDeferredEmit()) {
          // Continue looping while at least one plugin emitted an event
        }
      }

      // Tell the stream that we're done
      done();
    } catch (error) {
      done(error as Error);
    }
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    try {
      for (const plugin of this.plugins) await plugin.processCloseStream();
      info('stream', 'Gekko is closing the application !');
      done();
    } catch (error) {
      if (error instanceof Error) done(error);
    }
  }
}
