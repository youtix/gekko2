export interface VolumeDeltaStrategyParams {
  src: 'quote';
  short: number;
  long: number;
  signal: number;
  output: 'volumeDelta' | 'macd' | 'signal' | 'hist';
  thresholds: {
    up: number;
    down: number;
    persistence: number;
  };
}

export type VolumeDeltaTrend = {
  duration: number;
  persisted: boolean;
  direction: 'up' | 'down' | 'none';
  adviced: boolean;
};
