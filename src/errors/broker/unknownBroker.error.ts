export class UnknownBrokerError extends Error {
  constructor(brokerName: string) {
    super(`Unknown ${brokerName} broker.`);
    this.name = 'UnknownBrokerError';
  }
}
