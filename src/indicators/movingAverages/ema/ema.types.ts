import { InputSources } from '@indicators/indicator.types';

declare global {
  interface IndicatorRegistry {
    EMA: { input?: { period?: number; src?: InputSources }; output: number | null };
  }
}

export {};
