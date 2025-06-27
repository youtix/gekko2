import { Candle } from '@models/types/candle.types';
import { Nullable } from '@models/types/generic.types';
import { Plugin } from '@plugins/plugin';
import { info } from '@services/logger';
import { after, find } from 'lodash-es';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  plugins: Plugin[];
  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
  }

  public async _write(chunk: Candle, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    const flushEvents = this.flushEvents().bind(this);
    for (const plugin of this.plugins) await plugin.processInputStream(chunk, flushEvents);
    done();
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    for (const plugin of this.plugins) await plugin.processCloseStream();
    info('stream', 'Gekko is closing the application !');
    done();
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
}
