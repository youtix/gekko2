import { BrokerError } from './broker.error';

export class UnknownBrokerError extends BrokerError {
  constructor(brokerName: string) {
    super(`Unknown ${brokerName} broker.`);
    this.name = 'UnknownBrokerError';
  }
}
