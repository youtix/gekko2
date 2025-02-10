import { BrokerError } from './broker.error';

export class MissingPropertyError extends BrokerError {
  constructor(property: string, call: string) {
    super(`Missing ${property} property in payload after calling ${call} function.`);
    this.name = 'MissingPropertyError';
  }
}
