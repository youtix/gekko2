import { InputSources } from '@models/inputSources.types';

declare global {
  interface IndicatorRegistry {
    MACD: {
      input?: { short?: number; long?: number; signal?: number; src?: InputSources };
      output: { macd: number; signal: number; hist: number } | null;
    };
  }
}

export {};
