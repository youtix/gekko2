export class ImporterError extends Error {
  constructor(message: string) {
    super(`Error when importing candle from exchange: ${message}`);
    this.name = 'ImporterError';
  }
}
