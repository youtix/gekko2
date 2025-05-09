import { MovingAverageTypes } from '@indicators/indicator.types';

declare global {
  interface IndicatorRegistry {
    BollingerBands: {
      input?: { period?: number; stdevUp?: number; stdevDown?: number; maType?: MovingAverageTypes };
      output: { upper: number | null; lower: number | null; middle: number | null };
    };
  }
}

export {};
