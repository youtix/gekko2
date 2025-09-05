import { Order } from '@models/order.types';
import { Kline } from 'binance';
import { map, pick } from 'lodash-es';
import { Candle } from '../../models/candle.types';
import { Trade } from '../../models/trade.types';

export const mapToTrades = (trades: unknown[]) =>
  map(trades, trade => pick(trade, ['amount', 'price', 'timestamp', 'id', 'fee'])) as Trade[];

export const mapToOrder = (order: unknown): Order =>
  pick(order, ['id', 'status', 'filled', 'remaining', 'price', 'timestamp']) as Order;

export const mapKlinesToCandles = (candles: Kline[]): Candle[] =>
  candles.map(
    ([start, open, high, low, close, volume, _endTime, quoteVolume, _nbOfTrades, volumeActive, quoteVolumeActive]) => ({
      start,
      close: +close,
      high: +high,
      low: +low,
      open: +open,
      volume: +volume,
      quoteVolume: +quoteVolume,
      volumeActive: +volumeActive,
      quoteVolumeActive: +quoteVolumeActive,
    }),
  );
