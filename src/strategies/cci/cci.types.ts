// CCI strategy type definitions

declare global {
  interface StrategyRegistry {
    CCI: {
      period: number;
      thresholds: {
        up: number;
        down: number;
        persistence: number;
      };
    };
  }
}

export type CCIDirection = 'overbought' | 'oversold' | 'nodirection';

export interface CCITrend {
  direction: CCIDirection;
  duration: number;
  persisted: boolean;
  adviced: boolean;
}
