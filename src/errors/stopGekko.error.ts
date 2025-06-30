import { GekkoError } from './gekko.error';

export class StopGekkoError extends GekkoError {
  constructor() {
    super('gekko', 'Stopping Gekko Application');
    this.name = 'StopGekkoError';
  }
}
