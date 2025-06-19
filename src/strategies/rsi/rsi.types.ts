import { InputSources } from '@models/types/inputSources.types';

export type RSICurrentTrend = {
  duration: number;
  direction: 'high' | 'low' | 'none';
  adviced: boolean;
};

declare global {
  interface StrategyRegistry {
    RSI: {
      period: number;
      src: InputSources;
      thresholds: {
        high: number;
        low: number;
        persistence: number;
      };
    };
  }
}
