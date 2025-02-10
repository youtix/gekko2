export class IndicatorNotFoundError extends Error {
  constructor(indicatorName: string) {
    super(`${indicatorName} indicator not found.`);
    this.name = 'IndicatorNotFoundError';
  }
}
