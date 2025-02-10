import { getUnixTime, secondsToMilliseconds } from 'date-fns';
import { bindAll, defer } from 'lodash-es';
import EventEmitter from 'node:events';
import { FailedtoTickOnTimeError } from '../../../errors/failedToTickOnTime.error';
import { logger } from '../../logger';

/**
 * Heart Class
 *
 * The Heart class is responsible for scheduling and emitting heartbeat ticks
 * at regular intervals. It ensures that ticks are emitted on time, and logs
 * or terminates the process if timing issues occur.
 */
export class Heart extends EventEmitter {
  /** Stores the Unix timestamp (in seconds) of the last successful heartbeat. */
  lastTick: number;

  /** Defines the interval (in seconds) between each tick. */
  tickRate: number;

  timeout?: Timer;

  constructor(tickRate: number) {
    super();
    this.tickRate = tickRate;
    this.lastTick = 0;
    bindAll(this, ['tick']);
  }

  tick() {
    const currentTime = getUnixTime(new Date());

    // Check if the time since the last tick exceeds 3x the tick rate.
    if (this.lastTick && this.lastTick < currentTime - this.tickRate * 3)
      throw new FailedtoTickOnTimeError();

    this.lastTick = currentTime;
    this.emit('tick'); // Notify all listeners about the tick event.
  }

  pump() {
    logger.debug('Starting heartbeat ticks');
    // Schedule recurring ticks.
    this.timeout = setInterval(this.tick, secondsToMilliseconds(this.tickRate));
    // Trigger an immediate tick to kickstart the process.
    defer(this.tick);
  }

  stop() {
    logger.debug('Stoping heartbeat ticks');
    clearInterval(this.timeout);
  }
}
