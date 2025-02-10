export class NoDaterangeFoundError extends Error {
  constructor() {
    super('No daterange found in database');
    this.name = 'NoDaterangeFoundError';
  }
}
