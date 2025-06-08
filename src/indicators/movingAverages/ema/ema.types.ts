import { InputSources } from '@models/types/inputSources.types';

declare global {
  interface IndicatorRegistry {
    EMA: { input?: { period?: number; src?: InputSources }; output: number | null };
  }
}

export {};
