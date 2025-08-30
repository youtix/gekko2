import { MovingAverageTypes } from '@indicators/indicator.types';
import { Nullable } from '@models/utility.types';

declare global {
  interface IndicatorRegistry {
    OBV: {
      input?: { period?: number; stdevUp?: number; stdevDown?: number; maType?: MovingAverageTypes };
      output: { obv: Nullable<number>; ma: Nullable<number>; upper: Nullable<number>; lower: Nullable<number> };
    };
  }
}

export {};
