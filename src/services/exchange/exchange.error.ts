import { GekkoError } from '@errors/gekko.error';

export class UndefinedLimitsError extends GekkoError {
  constructor(property: string, min?: number, max?: number) {
    super(
      'exchange',
      `${property} limits are not defined (min: ${min ?? 'unknown'}, max: ${max ?? 'unknown'}). Ensure market metadata has been loaded before trading.`,
    );
    this.name = 'UndefinedLimitsError';
  }
}

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
