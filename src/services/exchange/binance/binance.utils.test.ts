import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
import type { RawAccountTrade, RawTrade } from 'binance';
import {
  mapAccountTradeToTrade,
  mapKlinesToCandles,
  mapPublicTradeToTrade,
  mapSpotOrderToOrder,
} from './binance.utils';

describe('binance.utils', () => {
  const kline1 = [123456, 1, 2, 0.5, 1.5, 100, 0, 10, 0, 256, 234];
  const kline2 = [123457, 1.5, 2.5, 1, 2, 200, 0, 5, 0, 156, 123];
  const candle1: Candle = {
    start: 123456,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
    quoteVolume: 10,
    quoteVolumeActive: 234,
    volumeActive: 256,
  };
  const candle2: Candle = {
    start: 123457,
    open: 1.5,
    high: 2.5,
    low: 1,
    close: 2,
    volume: 200,
    quoteVolume: 5,
    quoteVolumeActive: 123,
    volumeActive: 156,
  };

  describe('mapPublicTradeToTrade', () => {
    it('should map public trades', () => {
      const trade: RawTrade = {
        id: 123,
        qty: '1.5',
        price: '20000',
        quoteQty: '30000',
        time: 456789,
        isBuyerMaker: false,
        isBestMatch: true,
      };
      expect(mapPublicTradeToTrade(trade)).toEqual({
        id: '123',
        amount: 1.5,
        price: 20000,
        timestamp: 456789,
        fee: { rate: 0 },
      });
    });
  });

  describe('mapAccountTradeToTrade', () => {
    it('should map account trades', () => {
      const trade: RawAccountTrade = {
        id: 321,
        orderId: 654,
        qty: '0.1',
        price: '30000',
        quoteQty: '3000',
        commission: '1.5',
        commissionAsset: 'USDT',
        symbol: 'BTCUSDT',
        isBuyer: true,
        isMaker: false,
        isBestMatch: true,
        orderListId: -1,
        time: 123456,
      };
      expect(mapAccountTradeToTrade(trade)).toEqual({
        id: '654',
        amount: 0.1,
        price: 30000,
        timestamp: 123456,
        fee: { rate: 0.0005 },
      });
    });
  });

  describe('mapSpotOrderToOrder', () => {
    it('should map order payloads', () => {
      const order = {
        orderId: 42,
        status: 'FILLED',
        executedQty: '1',
        origQty: '1.5',
        price: '100',
        updateTime: 987654,
      };
      expect(mapSpotOrderToOrder(order)).toEqual({
        id: '42',
        status: 'closed',
        filled: 1,
        remaining: 0.5,
        price: 100,
        timestamp: 987654,
      });
    });
  });

  describe('mapKlinesToCandles', () => {
    it.each`
      candles             | expected
      ${[kline1, kline2]} | ${[candle1, candle2]}
      ${[]}               | ${[]}
    `('should map candles=$candles to $expected', ({ candles, expected }) => {
      const result = mapKlinesToCandles(candles);
      expect(result).toEqual(expected);
    });
  });
});
