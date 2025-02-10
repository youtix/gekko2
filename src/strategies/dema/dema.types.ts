declare global {
  interface StrategyRegistry {
    DEMA: { period: number; thresholds: { up: number; down: number } };
  }
}

export {};
