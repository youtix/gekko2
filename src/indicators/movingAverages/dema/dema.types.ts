declare global {
  interface IndicatorRegistry {
    DEMA: { input: { weight: number }; output: number };
  }
}

export {};
