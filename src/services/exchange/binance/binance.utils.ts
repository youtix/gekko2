import { Candle } from '@models/candle.types';
import { Order } from '@models/order.types';
import { Trade } from '@models/trade.types';
import { Kline, RawAccountTrade, RawTrade } from 'binance';

export type BinanceSpotOrder = Partial<{
  orderId: number;
  id: number;
  clientOrderId: string;
  origClientOrderId: string;
  status: string;
  executedQty: string | number;
  origQty: string | number;
  cummulativeQuoteQty: string | number;
  price: string | number;
  updateTime: number;
  transactTime: number;
  time: number;
}>;

const parseNumber = (value?: string | number) => {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const mapOrderStatus = (status?: string): Order['status'] => {
  switch (status) {
    case 'FILLED':
      return 'closed';
    case 'CANCELED':
    case 'EXPIRED':
    case 'REJECTED':
      return 'canceled';
    default:
      return 'open';
  }
};

export const mapPublicTradeToTrade = (trade: RawTrade): Trade => ({
  id: String(trade.id),
  amount: parseNumber(trade.qty) ?? 0,
  price: parseNumber(trade.price) ?? 0,
  timestamp: trade.time,
  fee: { rate: 0 },
});

export const mapAccountTradeToTrade = (trade: RawAccountTrade): Trade => {
  const amount = parseNumber(trade.qty) ?? 0;
  const price = parseNumber(trade.price) ?? 0;
  const quoteQuantity = parseNumber(trade.quoteQty) ?? amount * price;
  const commission = parseNumber(trade.commission) ?? 0;
  const feeRate = quoteQuantity ? commission / quoteQuantity : 0;

  return {
    id: String(trade.orderId ?? trade.id),
    amount,
    price,
    timestamp: trade.time,
    fee: { rate: feeRate },
  };
};

export const mapSpotOrderToOrder = (data: BinanceSpotOrder): Order => {
  const filled = parseNumber(data.executedQty) ?? 0;
  const original = parseNumber(data.origQty) ?? filled;
  const cumulativeQuote = parseNumber(data.cummulativeQuoteQty);
  const price =
    parseNumber(data.price) ?? (cumulativeQuote !== undefined && original ? cumulativeQuote / original : undefined);

  return {
    id: String(data.orderId ?? data.id ?? data.clientOrderId ?? data.origClientOrderId ?? ''),
    status: mapOrderStatus(data.status),
    filled,
    remaining: Math.max(original - filled, 0),
    price,
    timestamp: data.updateTime ?? data.transactTime ?? data.time ?? Date.now(),
  };
};

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
