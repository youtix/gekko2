import { MovingAverageTypes } from '@indicators/indicator.types';
import { InputSources } from '@models/types/inputSources.types';
import { Nullable } from '@models/types/utility.types';

declare global {
  interface IndicatorRegistry {
    EFI: {
      input?: { period?: number; maType?: MovingAverageTypes; src?: InputSources };
      output: { fi: Nullable<number>; smoothed: Nullable<number> };
    };
  }
}

export {};
