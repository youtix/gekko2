import { MovingAverageTypes } from '@indicators/indicator.types';

declare global {
  interface IndicatorRegistry {
    Stochastic: {
      input: {
        fastKPeriod: number;
        slowKPeriod: number;
        slowKMaType: MovingAverageTypes;
        slowDPeriod: number;
        slowDMaType: MovingAverageTypes;
      };
      output: { k: number | null; d: number | null };
    };
  }
}

export {};
