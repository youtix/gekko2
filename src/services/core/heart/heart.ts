import { GekkoError } from '@errors/gekko.error';
import { debug } from '@services/logger';
import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';

export class Heart extends EventEmitter {
  private lastTick: number;
  private tickRate: number;
  private timeout?: Timer;

  constructor(tickRate: number) {
    super();
    this.tickRate = tickRate;
    this.lastTick = 0;
    bindAll(this, ['tick']);
  }

  public tick() {
    const currentTime = Date.now();
    if (this.lastTick && this.lastTick < currentTime - this.tickRate * 3)
      throw new GekkoError('core', 'Failed to tick in time'); // see https://github.com/askmike/gekko/issues/514 for details

    this.lastTick = currentTime;
    this.emit('tick');
  }

  public pump() {
    debug('core', 'Starting heartbeat ticks');
    this.timeout = setInterval(this.tick, this.tickRate);
    defer(this.tick);
  }

  public stop() {
    debug('core', 'Stopping heartbeat ticks');
    clearInterval(this.timeout);
    this.timeout = undefined;
  }

  public isHeartBeating() {
    return !!this.timeout;
  }
}
