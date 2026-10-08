import { Candle } from '@models/candle.types';
import { hl2, hlc3, ohlc4 } from '@utils/candle/candle.utils';

export const INPUT_SOURCES = {
  open: (candle: Candle) => candle.open,
  high: (candle: Candle) => candle.high,
  low: (candle: Candle) => candle.low,
  close: (candle: Candle) => candle.close,
  hl2,
  hlc3,
  ohlc4,
} as const;
