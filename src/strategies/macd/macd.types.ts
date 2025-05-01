declare global {
  interface StrategyRegistry {
    MACD: {
      short: number;
      long: number;
      signal: number;
      thresholds: {
        up: number;
        down: number;
        persistence: number; // Emit advice once the signal has persisted for the specified number of consecutive candles.
      };
    };
  }
}

export type MACDTrend = { duration: number; persisted: boolean; direction: 'up' | 'down' | 'none'; adviced: boolean };
