import { GekkoError } from '@errors/gekko.error';

export class PerformanceAnalyzerError extends GekkoError {
  constructor(message: string) {
    super('performance analyzer', message);
    this.name = 'PerformanceAnalyzerError';
  }
}
