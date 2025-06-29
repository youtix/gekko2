import { MovingAverageTypes } from '@indicators/indicator.types';
import { Nullable } from '@models/types/generic.types';
import { InputSources } from '@models/types/inputSources.types';

declare global {
  interface IndicatorRegistry {
    EFI: {
      input?: { period?: number; maType?: MovingAverageTypes; src?: InputSources };
      output: { fi: Nullable<number>; smoothed: Nullable<number> };
    };
  }
}

export {};
