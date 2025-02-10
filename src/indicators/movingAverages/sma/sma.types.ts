declare global {
  interface IndicatorRegistry {
    SMA: { input: { weight: number }; output: number };
  }
}

export {};
