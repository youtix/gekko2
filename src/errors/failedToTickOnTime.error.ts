import { GekkoError } from './gekko.error';

export class FailedtoTickOnTimeError extends GekkoError {
  constructor() {
    super('heart', 'Failed to tick in time, see https://github.com/askmike/gekko/issues/514 for details');
    this.name = 'FailedtoTickOnTimeError';
  }
}
