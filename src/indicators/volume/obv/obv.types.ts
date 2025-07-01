declare global {
  interface IndicatorRegistry {
    OBV: { input?: null; output: number | null };
  }
}

export {};
