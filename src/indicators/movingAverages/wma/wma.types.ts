declare global {
  interface IndicatorRegistry {
    WMA: { input: { period: number }; output: number | null };
  }
}

export {};
