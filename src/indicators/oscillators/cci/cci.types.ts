declare global {
  interface IndicatorRegistry {
    CCI: { input: { history: number; constant: number }; output: number };
  }
}

export {};
