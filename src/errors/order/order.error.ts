import { GekkoError } from '@errors/gekko.error';

export class OrderError extends GekkoError {
  constructor(message: string) {
    super('order', message);
    this.name = 'OrderError';
  }
}
