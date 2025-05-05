export const ADVICE_EVENT = 'advice';
export const STRATEGY_CANDLE_EVENT = 'strategyCandle';
export const STRATEGY_NOTIFICATION_EVENT = 'strategyNotification';
export const STRATEGY_UPDATE_EVENT = 'strategyUpdate';
export const STRATEGY_WARMUP_COMPLETED_EVENT = 'strategyWarmupCompleted';
export const TIMEFRAMES = [
  '1m',
  '2m',
  '3m',
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '1w',
  '1M',
  '3M',
  '6M',
  '1y',
] as const;
export const TIMEFRAME_TO_MINUTES = {
  '1m': 1,
  '2m': 2,
  '3m': 3,
  '5m': 5,
  '10m': 10,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '1w': 10080,
  '1M': 43200,
  '3M': 129600,
  '6M': 259200,
  '1y': 518400,
} as const;
