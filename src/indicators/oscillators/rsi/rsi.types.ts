import { InputSources } from '@models/types/inputSources.types';

declare global {
  interface IndicatorRegistry {
    RSI: { input?: { period?: number; src?: InputSources }; output: number | null };
  }
}

export {};
