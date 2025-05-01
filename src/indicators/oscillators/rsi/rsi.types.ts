declare global {
  interface IndicatorRegistry {
    RSI: { input: { period: number }; output: number | null };
  }
}

export {};
