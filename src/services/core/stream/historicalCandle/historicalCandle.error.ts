export class HistoricalCandleError extends Error {
  constructor(message: string) {
    super(`Error when importing candle from exchange: ${message}`);
    this.name = 'HistoricalCandleError';
  }
}
