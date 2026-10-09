import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';

export const SYNTHETIC_START_PRICE = 10000;
export const SYNTHETIC_VOLUME = 50;

/**
 * Generates a deterministic candle based on a timestamp and symbol.
 * Uses a sine wave to simulate price movement.
 */
export const generateSyntheticCandle = (symbol: string, timestamp: number): Candle => {
  // Normalize timestamp to minutes for the sine wave input
  const t = timestamp / ONE_MINUTE;

  // Use symbol char codes to offset the wave so different pairs have different prices
  const offset = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  // Sine wave: Amplitude 100, Period ~60 minutes
  const priceChange = Math.sin((t + offset) / 10) * 100;
  const basePrice = SYNTHETIC_START_PRICE + priceChange;

  return {
    start: timestamp,
    // deterministic variation for OHLC
    open: basePrice,
    high: basePrice + 5,
    low: basePrice - 5,
    close: basePrice + (Math.sin((t + offset + 1) / 10) * 100 - priceChange), // Next step's influence
    volume: SYNTHETIC_VOLUME + Math.cos(t) * 10,
  };
};

export const generateSyntheticHistory = (symbol: string, start: number, limit: number): Candle[] => {
  const candles: Candle[] = [];
  for (let i = 0; i < limit; i++) {
    candles.push(generateSyntheticCandle(symbol, start + i * ONE_MINUTE));
  }
  return candles;
};
