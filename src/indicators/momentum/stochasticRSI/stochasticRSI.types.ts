import { MovingAverageTypes } from '@indicators/indicator.types';

declare global {
  interface IndicatorRegistry {
    StochasticRSI: {
      input?: {
        period?: number;
        fastKPeriod?: number;
        fastDPeriod?: number;
        slowMaType?: MovingAverageTypes;
      };
      output: { fastK: number | null; fastD: number | null };
    };
  }
}

export {};
