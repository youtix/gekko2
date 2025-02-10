export class MissingBrokerFeatureError extends Error {
  constructor(brokerName: string, feature: string) {
    super(`Missing ${feature} feature in ${brokerName} broker`);
    this.name = 'MissingBrokerFeatureError';
  }
}
