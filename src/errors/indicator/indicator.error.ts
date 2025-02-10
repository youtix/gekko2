export class IndicatorError extends Error {
  constructor(indicatorName: string) {
    super(`Someting went wrong when using ${indicatorName} indicator.`);
    this.name = 'IndicatorBadStateError';
  }
}
