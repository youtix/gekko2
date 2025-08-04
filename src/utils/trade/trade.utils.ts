import { Order } from '@models/types/order.types';
import { OHLCV } from 'ccxt';
import { isBefore } from 'date-fns';
import { filter, map, pick, zipObject } from 'lodash-es';
import { Candle } from '../../models/types/candle.types';
import { Trade } from '../../models/types/trade.types';

export const filterTradesByTimestamp = (trades: Trade[], threshold?: EpochTimeStamp) =>
  threshold ? filter(trades, ({ timestamp }) => !isBefore(timestamp, threshold)) : trades;

export const mapToTrades = (trades: unknown[]) =>
  map(trades, trade => pick(trade, ['amount', 'price', 'timestamp', 'id', 'fee'])) as Trade[];

export const mapToOrder = (order: unknown): Order =>
  pick(order, ['id', 'status', 'filled', 'remaining', 'price', 'timestamp']) as Order;

export const mapToCandles = (candles: OHLCV[]): Candle[] =>
  map(candles, candle => zipObject(['start', 'open', 'high', 'low', 'close', 'volume'], [...candle]) as Candle);
