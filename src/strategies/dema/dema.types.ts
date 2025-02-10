declare global {
  interface StrategyRegistry {
    DEMA: { weight: number; thresholds: { up: number; down: number } };
  }
}

export {};
