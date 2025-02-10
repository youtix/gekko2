declare global {
  interface IndicatorRegistry {
    EMA: { input: { weight: number }; output: number };
  }
}

export {};
