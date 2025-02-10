export class BrokerError extends Error {
  constructor(message: string) {
    super(`[BROKER] ${message}`);
    this.name = 'BrokerError';
  }
}
