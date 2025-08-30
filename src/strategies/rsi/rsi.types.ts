import { InputSources } from '@models/inputSources.types';

export type RSICurrentTrend = {
  duration: number;
  direction: 'high' | 'low' | 'none';
  adviced: boolean;
};

export interface RSIStrategyParams {
  period: number;
  src: InputSources;
  thresholds: {
    high: number;
    low: number;
    persistence: number;
  };
}
