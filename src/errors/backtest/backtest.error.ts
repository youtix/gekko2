import { GekkoError } from '@errors/gekko.error';

export class BacktestError extends GekkoError {
  constructor(message: string) {
    super('backtest', message);
    this.name = 'BacktestError';
  }
}
