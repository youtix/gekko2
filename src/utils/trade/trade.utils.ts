import { Order } from '@models/order.types';
import { OHLCV } from 'ccxt';
import { map, pick, zipObject } from 'lodash-es';
import { Candle } from '../../models/candle.types';
import { Trade } from '../../models/trade.types';

export const mapToTrades = (trades: unknown[]) =>
  map(trades, trade => pick(trade, ['amount', 'price', 'timestamp', 'id', 'fee'])) as Trade[];

export const mapToOrder = (order: unknown): Order =>
  pick(order, ['id', 'status', 'filled', 'remaining', 'price', 'timestamp']) as Order;

export const mapToCandles = (candles: OHLCV[]): Candle[] =>
  map(candles, candle => zipObject(['start', 'open', 'high', 'low', 'close', 'volume'], [...candle]) as Candle);
