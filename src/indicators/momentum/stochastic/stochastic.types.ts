declare global {
  interface IndicatorRegistry {
    Stochastic: {
      input: {
        fastKPeriod: number;
        slowKPeriod: number;
        slowKMaType: 'sma' | 'ema' | 'dema' | 'wma';
        slowDPeriod: number;
        slowDMaType: 'sma' | 'ema' | 'dema' | 'wma';
      };
      output: { k: number | null; d: number | null };
    };
  }
}

export {};
