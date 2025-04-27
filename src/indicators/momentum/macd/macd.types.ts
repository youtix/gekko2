declare global {
  interface IndicatorRegistry {
    MACD: {
      input: { short: number; long: number; signal: number };
      output: { macd: number | null; signal: number | null; hist: number | null };
    };
  }
}

export {};
