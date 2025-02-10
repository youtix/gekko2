import { BacktestError } from './backtest.error';

export class NoDaterangeFoundError extends BacktestError {
  constructor() {
    super('No daterange found in database');
    this.name = 'NoDaterangeFoundError';
  }
}
