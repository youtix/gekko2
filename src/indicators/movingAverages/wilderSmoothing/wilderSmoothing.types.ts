import { InputSources } from '@models/inputSources.types';

declare global {
  interface IndicatorRegistry {
    WilderSmoothing: { input?: { period?: number; src?: InputSources }; output: number | null };
  }
}

export {};
