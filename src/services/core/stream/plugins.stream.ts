import { Candle } from '@models/types/candle.types';
import { Plugin } from '@plugins/plugin';
import { debug } from '@services/logger';
import { after, bind, each, find } from 'lodash-es';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  plugins: Plugin[];
  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
  }

  public _write(chunk: Candle, _: BufferEncoding, done: (error?: Error | null) => void): void {
    const flushEvents = bind(this.flushEvents(done), this);
    each(this.plugins, c => c.processInputStream(chunk, flushEvents));
  }

  public end(_?: unknown, __?: unknown, done?: (error?: Error | null) => void): this {
    each(this.plugins, c => c.processCloseStream(done));
    debug('stream', 'Stream ended !');
    return this;
  }

  private flushEvents(done: (error?: Error | null) => void) {
    return after(this.plugins.length, () => {
      this.broadcastRecursively();
      done();
    });
  }

  private broadcastRecursively() {
    const hasBroadcasted = find(this.plugins, p => p.broadcastDeferredEmit());
    if (hasBroadcasted) this.broadcastRecursively();
  }
}
