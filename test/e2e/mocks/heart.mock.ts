import type { HeartOptions } from '@services/core/heart/heart';
import EventEmitter from 'node:events';

/** Ticks right after pump(), then every tick rate from there, unaligned on the boundaries, so that the scenarios run fast */
export class MockHeart extends EventEmitter {
  private static instances: Set<MockHeart> = new Set();

  private tickRate: number;
  private timeout?: Timer;

  constructor(tickRate: number, _options?: HeartOptions) {
    super();
    this.tickRate = tickRate;
    MockHeart.instances.add(this);
  }

  public tick() {
    this.emit('tick');
  }

  public pump() {
    if (this.isHeartBeating()) return;
    this.timeout = setTimeout(() => this.beat(), 0);
  }

  public stop() {
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  public isHeartBeating() {
    return !!this.timeout;
  }

  /** Stop all active MockHeart instances. Use in beforeEach to prevent timer leakage across tests. */
  public static stopAll() {
    for (const instance of MockHeart.instances) {
      instance.stop();
      instance.removeAllListeners();
    }
    MockHeart.instances.clear();
  }

  private beat() {
    this.timeout = setTimeout(() => this.beat(), this.tickRate);
    this.tick();
  }
}
