declare global {
  interface IndicatorRegistry {
    MACD: { input: { short: number; long: number; signal: number }; output: number | null };
  }
}

export {};
