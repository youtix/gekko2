declare global {
  interface IndicatorRegistry {
    SMMA: { input: { weight: number }; output: number };
  }
}

export {};
