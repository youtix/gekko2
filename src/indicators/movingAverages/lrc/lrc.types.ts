declare global {
  interface IndicatorRegistry {
    LRC: { input: { depth: number }; output: number };
  }
}

export {};
