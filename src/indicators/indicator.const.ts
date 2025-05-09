import { DEMA, EMA, SMA, WMA } from './movingAverages';

export const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;
