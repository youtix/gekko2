import { InputSources } from '@models/types/inputSources.types';

declare global {
  interface StrategyRegistry {
    TMA: { short: number; medium: number; long: number; src: InputSources };
  }
}

export {};
