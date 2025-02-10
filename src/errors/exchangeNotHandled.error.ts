export class ExchangeNotHandledError extends Error {
  constructor(feature: string) {
    super(`Exchange not handled by gekko: missing ${feature} feature`);
    this.name = 'ExchangeNotHandledError';
  }
}
