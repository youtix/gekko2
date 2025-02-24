import { BrokerError } from './broker.error';

export class MissingBrokerFeatureError extends BrokerError {
  constructor(brokerName: string, feature: string) {
    super(`Missing ${feature} feature in ${brokerName} broker`);
    this.name = 'MissingBrokerFeatureError';
  }
}
