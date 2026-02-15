import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';

export class MockHeart extends EventEmitter {
  private tickRate: number;
  private timeout?: Timer;

  constructor(tickRate: number) {
    super();
    this.tickRate = tickRate;
    bindAll(this, ['tick']);
  }

  public tick() {
    this.emit('tick');
  }

  public pump() {
    this.timeout = setInterval(this.tick, this.tickRate);
    defer(this.tick);
  }

  public stop() {
    clearInterval(this.timeout);
    this.timeout = undefined;
  }

  public isHeartBeating() {
    return !!this.timeout;
  }
}
