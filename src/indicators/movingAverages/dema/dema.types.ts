declare global {
  interface IndicatorRegistry {
    DEMA: { input: { period: number }; output: number | null };
  }
}

export {};
