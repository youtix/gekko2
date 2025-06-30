declare global {
  interface IndicatorRegistry {
    WilderSmoothing: { input?: { period?: number }; output: number | null };
  }
}

export {};
