import { GekkoError } from '@errors/gekko.error';

export class UndefinedLimitsError extends GekkoError {
  constructor(property: string, min?: number, max?: number) {
    super(
      'exchange',
      `${property} limits are not defined (minimal ${property}: ${min}, maximal ${property}: ${max}). Did you forget to call exchange.loadMarkets() ?`,
    );
    this.name = 'UndefinedLimitsError';
  }
}
