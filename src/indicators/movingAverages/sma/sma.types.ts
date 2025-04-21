declare global {
  interface IndicatorRegistry {
    SMA: { input: { period: number }; output: number | null };
  }
}

export {};
