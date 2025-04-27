export class InvalidDateRangeError extends Error {
  constructor(from?: string, to?: string) {
    super(`Wrong date range: ${from} -> ${to}`);
    this.name = 'InvalidDateRangeError';
  }
}
