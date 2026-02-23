import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';

export class MockHeart extends EventEmitter {
  private static instances: Set<MockHeart> = new Set();

  private tickRate: number;
  private timeout?: Timer;

  constructor(tickRate: number) {
    super();
    this.tickRate = tickRate;
    bindAll(this, [this.tick.name]);
    MockHeart.instances.add(this);
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

  /** Stop all active MockHeart instances. Use in beforeEach to prevent timer leakage across tests. */
  public static stopAll() {
    for (const instance of MockHeart.instances) {
      instance.stop();
      instance.removeAllListeners();
    }
    MockHeart.instances.clear();
  }
}
