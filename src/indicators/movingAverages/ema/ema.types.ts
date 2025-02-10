declare global {
  interface IndicatorRegistry {
    EMA: { input: { period: number }; output: number | null };
  }
}

export {};
