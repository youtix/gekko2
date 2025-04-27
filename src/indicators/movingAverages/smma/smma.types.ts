declare global {
  interface IndicatorRegistry {
    SMMA: { input: { period: number }; output: number | null };
  }
}

export {};
