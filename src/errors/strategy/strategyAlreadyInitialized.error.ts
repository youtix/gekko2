export class StrategyAlreadyInitializedError extends Error {
  constructor(indicatorName: string) {
    super(`Can only add indicators (${indicatorName} ) in init function of the strategy.`);
    this.name = 'StrategyAlreadyInitializedError';
  }
}
