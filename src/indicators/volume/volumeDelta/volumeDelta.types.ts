import { Nullable } from '@models/utility.types';

declare global {
  interface IndicatorRegistry {
    VolumeDelta: {
      input?: { src?: 'quote' | 'base'; short?: number; long?: number; signal?: number };
      output: Nullable<{
        volumeDelta: Nullable<number>;
        macd: Nullable<number>;
        signal: Nullable<number>;
        hist: Nullable<number>;
      }>;
    };
  }
}

export {};
