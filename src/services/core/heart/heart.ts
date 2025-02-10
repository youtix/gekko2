import { getUnixTime, secondsToMilliseconds } from 'date-fns';
import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';
import { FailedtoTickOnTimeError } from '../../../errors/failedToTickOnTime.error';
import { logger } from '../../logger';

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
    const currentTime = getUnixTime(new Date());
    if (this.lastTick && this.lastTick < currentTime - this.tickRate * 3) throw new FailedtoTickOnTimeError();

    this.lastTick = currentTime;
    this.emit('tick');
  }

  public pump() {
    logger.debug('Starting heartbeat ticks');
    this.timeout = setInterval(this.tick, secondsToMilliseconds(this.tickRate));
    defer(this.tick);
  }

  public stop() {
    logger.debug('Stoping heartbeat ticks');
    clearInterval(this.timeout);
    this.timeout = undefined;
  }

  public isHeartBeating() {
    return !!this.timeout;
  }
}
