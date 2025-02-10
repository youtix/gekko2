export class StrategyNotFoundError extends Error {
  constructor(strategyName: string) {
    super(`${strategyName} strategy not found.`);
    this.name = 'StrategyNotFoundError';
  }
}
