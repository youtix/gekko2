import { debug } from '@services/logger';
import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';

export class MockHeart extends EventEmitter {
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
    // In tests, we skip the tick lag check to prevent "Failed to tick in time" errors
    // caused by CPU starvation or debugging pauses.
    // if (this.lastTick && this.lastTick < currentTime - this.tickRate * 3) ...

    this.lastTick = currentTime;
    this.emit('tick');
  }

  public pump() {
    debug('core', 'Starting (mock) heartbeat ticks');
    this.timeout = setInterval(this.tick, this.tickRate);
    defer(this.tick);
  }

  public stop() {
    debug('core', 'Stopping (mock) heartbeat ticks');
    clearInterval(this.timeout);
    this.timeout = undefined;
  }

  public isHeartBeating() {
    return !!this.timeout;
  }
}
