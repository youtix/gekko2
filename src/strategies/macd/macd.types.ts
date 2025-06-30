declare global {
  interface StrategyRegistry {
    MACD: {
      short: number;
      long: number;
      signal: number;
      macdSrc: 'hist' | 'signal' | 'macd';
      thresholds: {
        up: number;
        down: number;
        persistence: number;
      };
    };
  }
}

export type MACDTrend = { duration: number; persisted: boolean; direction: 'up' | 'down' | 'none'; adviced: boolean };
