export class FailedtoTickOnTimeError extends Error {
  constructor() {
    super('Failed to tick in time, see https://github.com/askmike/gekko/issues/514 for details');
    this.name = 'FailedtoTickOnTimeError';
  }
}
