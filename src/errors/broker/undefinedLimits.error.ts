import { BrokerError } from './broker.error';

export class UndefinedLimitsError extends BrokerError {
  constructor(property: string, min?: number, max?: number) {
    super(
      `${property} limits are not defined (minimal ${property}: ${min}, maximal ${property}: ${max}). Did you forget to call broker.loadMarkets() ?`,
    );
    this.name = 'UndefinedLimitsError';
  }
}
