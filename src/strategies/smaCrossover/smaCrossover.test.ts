import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SMACrossover } from './smaCrossover.strategy';

describe('SMACrossover Strategy', () => {
  let strategy: SMACrossover;
  let advices: AdviceOrder[];
  let tools: any;
  let bucket: CandleBucket;

  const createCandle = (close: number) => ({ close, open: close, high: close, low: close }) as any;
  const setBucket = (price: number) => {
    bucket = new Map();
    bucket.set('BTC/USDT', createCandle(price));
  };

  beforeEach(() => {
    strategy = new SMACrossover();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      strategyParams: { period: 20, src: 'close' },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };

    // Default bucket
    setBucket(100);
    strategy.init({ candle: bucket, tools, addIndicator: vi.fn() } as any);
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it.each`
      description                                  | sma          | expectedAdvicesCount
      ${'do nothing when SMA result is undefined'} | ${undefined} | ${0}
      ${'do nothing when SMA result is null'}      | ${null}      | ${0}
    `('should $description', ({ sma, expectedAdvicesCount }) => {
      setBucket(100);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, sma);
      expect(advices).toHaveLength(expectedAdvicesCount);
    });

    it('should record initial state without creating an order on first candle', () => {
      setBucket(100);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 95); // price above SMA
      expect(advices).toHaveLength(0);
      expect(tools.log).toHaveBeenCalledWith('info', expect.stringContaining('Initial state'));
    });

    it.each`
      description                                                   | candle1Price | candle2Price | sma    | expectedSide
      ${'emit BUY when price crosses above SMA (SMA crosses DOWN)'} | ${90}        | ${110}       | ${100} | ${'BUY'}
      ${'emit SELL when price crosses below SMA (SMA crosses UP)'}  | ${110}       | ${90}        | ${100} | ${'SELL'}
    `('should $description', ({ candle1Price, candle2Price, sma, expectedSide }) => {
      setBucket(candle1Price);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, sma);

      setBucket(candle2Price);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, sma);

      expect(advices).toEqual([{ type: 'MARKET', side: expectedSide, amount: 1, symbol: 'BTC/USDT' }]);
    });

    it.each`
      description                                      | prices             | sma    | expectedAdvicesCount
      ${'not create order when price stays above SMA'} | ${[110, 115, 120]} | ${100} | ${0}
      ${'not create order when price stays below SMA'} | ${[90, 85, 80]}    | ${100} | ${0}
      ${'not create order when price equals SMA'}      | ${[100, 100, 100]} | ${100} | ${0}
    `('should $description', ({ prices, sma, expectedAdvicesCount }) => {
      for (const price of prices) {
        setBucket(price);
        strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, sma);
      }
      expect(advices).toHaveLength(expectedAdvicesCount);
    });

    it.each`
      description                        | prices                     | sma    | expectedSides
      ${'handle multiple crossovers'}    | ${[90, 110, 90, 110]}      | ${100} | ${['BUY', 'SELL', 'BUY']}
      ${'handle alternating crossovers'} | ${[110, 90, 110, 90, 110]} | ${100} | ${['SELL', 'BUY', 'SELL', 'BUY']}
    `('should $description correctly', ({ prices, sma, expectedSides }) => {
      for (const price of prices) {
        setBucket(price);
        strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, sma);
      }

      expect(advices).toHaveLength(expectedSides.length);
      for (let i = 0; i < expectedSides.length; i++) {
        expect(advices[i]).toEqual({ type: 'MARKET', side: expectedSides[i], amount: 1, symbol: 'BTC/USDT' });
      }
    });

    it('should always use MARKET order type', () => {
      setBucket(90);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 100);

      setBucket(110);
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 100);

      expect(advices[0].type).toBe('MARKET');
    });
  });

  describe('log', () => {
    it.each`
      description                        | sma          | shouldLog
      ${'log SMA and price values'}      | ${99.54321}  | ${true}
      ${'not log when SMA is undefined'} | ${undefined} | ${false}
      ${'not log when SMA is null'}      | ${null}      | ${false}
    `('should $description', ({ sma, shouldLog }) => {
      setBucket(100.12345);
      strategy.log({ candle: bucket, tools } as any, sma);

      if (shouldLog) {
        expect(tools.log).toHaveBeenCalledWith('debug', expect.stringContaining('SMA:'));
        expect(tools.log).toHaveBeenCalledWith('debug', expect.stringContaining('Price:'));
      } else {
        expect(tools.log).not.toHaveBeenCalled();
      }
    });
  });

  describe('init', () => {
    it('should add SMA indicator with period and src from strategyParams', () => {
      const addIndicator = vi.fn();
      tools.strategyParams = { period: 50, src: 'high' };
      setBucket(100);

      strategy.init({ tools, addIndicator, candle: bucket } as any);

      expect(addIndicator).toHaveBeenCalledWith('SMA', 'BTC/USDT', { period: 50, src: 'high' });
    });
  });
});
