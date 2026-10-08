import { z } from 'zod';

// The strategy counts its candles from 1: an index below 1, or with a fraction, never matched one and its order was never sent
const candleIndex = z.number().int().positive();
// A union whose options all fail only says "Invalid input": the message says what it expects
const candleIndexes = z.union([candleIndex, z.array(candleIndex)], {
  error: 'Invalid input: expected a candle index (a whole number, 1 for the first candle after the warmup) or a list of them',
});

export const debugBacktestStrategySchema = z.strictObject({
  buyCandleIndex: candleIndexes,
  sellCandleIndex: candleIndexes,
});
