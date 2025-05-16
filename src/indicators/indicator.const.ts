import { Candle } from '@models/types/candle.types';
import { hl2, hlc3, ohlc4 } from '@utils/candle/candle.utils';
import { DEMA } from './movingAverages/dema/dema.indicator';
import { EMA } from './movingAverages/ema/ema.indicator';
import { SMA } from './movingAverages/sma/sma.indicator';
import { WMA } from './movingAverages/wma/wma.indicator';

export const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

export const INPUT_SOURCES = {
  open: (candle: Candle) => candle.open,
  high: (candle: Candle) => candle.high,
  low: (candle: Candle) => candle.low,
  close: (candle: Candle) => candle.close,
  hl2,
  hlc3,
  ohlc4,
} as const;
