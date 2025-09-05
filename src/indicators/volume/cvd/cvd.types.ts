declare global {
  interface IndicatorRegistry {
    CVD: { input?: { source?: 'quote' | 'base' }; output: number | null };
  }
}

export {};
