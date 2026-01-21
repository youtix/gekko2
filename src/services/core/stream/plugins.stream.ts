import { CandleEvent } from '@models/event.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info, warning } from '@services/logger';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  private readonly plugins: Plugin[];
  private readonly dummyExchange?: DummyExchange;
  private finalized = false;

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

  public async _write({ symbol, candle }: CandleEvent, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    try {
      // Forward candle to dummy exchange (if set by user) before all plugins
      await this.dummyExchange?.processOneMinuteCandle(symbol, candle);

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
      // Finalize all plugins before destroying the stream
      await this.finalizeAllPlugins();
      info('stream', 'Gekko is closing the application due to an error!');
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    try {
      if (this.finalized) {
        done();
        return;
      }
      await this.finalizeAllPlugins();
      info('stream', 'Gekko is closing the application !');
      done();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Safely finalize all plugins, ensuring each plugin's cleanup runs
   * regardless of errors in other plugins.
   */
  private async finalizeAllPlugins(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    const results = await Promise.allSettled(this.plugins.map(plugin => plugin.processCloseStream()));

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => (r.reason instanceof Error ? r.reason : new Error(String(r.reason))));

    if (errors.length > 0) {
      warning('stream', `Finalization errors: ${errors.map(e => e.message).join(', ')}`);
    }
  }
}
