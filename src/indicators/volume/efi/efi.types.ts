import type { MovingAverageTypes } from '@indicators/indicator.types';
import { InputSources } from '@models/inputSources.types';

declare global {
  interface IndicatorRegistry {
    EFI: {
      input?: { period?: number; maType?: MovingAverageTypes; src?: InputSources };
      output: { fi: number; smoothed: number } | null;
    };
  }
}

export {};
