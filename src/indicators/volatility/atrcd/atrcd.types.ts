declare global {
  interface IndicatorRegistry {
    ATRCD: {
      input?: { short?: number; long?: number; signal?: number };
      output: { atrcd: number | null; signal: number | null; hist: number | null };
    };
  }
}

export {};
