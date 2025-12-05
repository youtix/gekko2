import { GekkoError } from '@errors/gekko.error';

export class InvalidOrder extends GekkoError {
  constructor(message: string) {
    super('exchange', message);
    this.name = 'InvalidOrder';
  }
}

export class OrderNotFound extends GekkoError {
  constructor(message: string) {
    super('exchange', message);
    this.name = 'OrderNotFound';
  }
}
