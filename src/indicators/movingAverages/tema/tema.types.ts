declare global {
  interface IndicatorRegistry {
    TEMA: { input: { period: number }; output: number | null };
  }
}

export {};
