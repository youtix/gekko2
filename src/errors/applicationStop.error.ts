import { GekkoError } from './gekko.error';

export class ApplicationStopError extends GekkoError {
  constructor(message: string) {
    super('core', message);
    this.name = 'ApplicationStopError';
  }
}
