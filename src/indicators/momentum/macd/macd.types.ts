import { InputSources } from '@indicators/indicator.types';

declare global {
  interface IndicatorRegistry {
    MACD: {
      input?: { short?: number; long?: number; signal?: number; src?: InputSources };
      output: { macd: number | null; signal: number | null; hist: number | null };
    };
  }
}

export {};
