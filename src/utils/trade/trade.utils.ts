import { OHLCV } from 'ccxt';
import { isAfter } from 'date-fns';
import { filter, map, pick, zipObject } from 'lodash-es';
import { Candle } from '../../models/types/candle.types';
import { Trade } from '../../models/types/trade.types';

export const filterTradesByTimestamp = (trades: Trade[], threshold: EpochTimeStamp) =>
  filter(trades, ({ timestamp }) => isAfter(timestamp, threshold));

export const mapToTrades = (trades: unknown[]) =>
  map(trades, (trade) => pick(trade, ['amount', 'price', 'timestamp'])) as Trade[];

export const mapToCandles = (candles: OHLCV[]): Candle[] =>
  map(
    candles,
    (candle) =>
      zipObject(['start', 'open', 'high', 'low', 'close', 'volume'], [...candle]) as Candle,
  );
