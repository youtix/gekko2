import { GekkoError } from '@errors/gekko.error';
import { Broker } from '@services/broker/broker';
import { bindAll } from 'lodash-es';
import EventEmitter from 'node:events';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ORDER_COMPLETED_EVENT, ORDER_ERRORED_EVENT } from '../../services/core/order/base/baseOrder.const';
import { StickyOrder } from '../../services/core/order/sticky/stickyOrder';
import { error, warning } from '../../services/logger';
import { wait } from '../../utils/process/process.utils';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_ABORTED_EVENT,
  TRADE_CANCELED_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_ERRORED_EVENT,
  TRADE_INITIATED_EVENT,
} from '../plugin.const';
import { Trader } from './trader';
import { SYNCHRONIZATION_INTERVAL } from './trader.const';
import { traderSchema } from './trader.schema';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getWatch: vi.fn(() => ({})), getStrategy: vi.fn(() => ({})) }));
  return { config: new Configuration() };
});
vi.mock('lodash-es', async () => ({
  ...(await vi.importActual('lodash-es')),
  bindAll: vi.fn(),
}));
vi.mock('../../utils/process/process.utils', () => ({
  wait: vi.fn(),
}));
vi.mock('../../services/core/order/sticky/stickyOrder', () => ({
  StickyOrder: class extends EventEmitter {},
}));

describe('Trader', () => {
  let onceEventCallback: () => Promise<void> = () => Promise.resolve();
  const setIntervalSpy = vi.spyOn(global, 'setInterval');
  let trader: any;
  let fakeBroker: {
    getBrokerName: Mock;
    getInterval: Mock;
    fetchTicker: Mock;
    fetchPortfolio: Mock;
  };
  let fakeOrder: {
    createSummary: Mock;
    removeAllListeners: Mock;
    cancel: Mock;
    once: Mock;
  };
  const summary = {
    amount: 2,
    price: 100,
    feePercent: 1,
    side: 'buy',
    date: 1609459200000, // Jan 1, 2021 in ms.
  };

  beforeEach(() => {
    fakeBroker = {
      getBrokerName: vi.fn().mockReturnValue('FakeBroker'),
      getInterval: vi.fn().mockReturnValue(50),
      fetchTicker: vi.fn().mockResolvedValue({ bid: 100 }),
      fetchPortfolio: vi.fn().mockResolvedValue({ asset: 1, currency: 50 }),
    };
    fakeOrder = {
      createSummary: vi.fn().mockResolvedValue(summary),
      removeAllListeners: vi.fn(),
      cancel: vi.fn(),
      once: vi.fn().mockImplementation((_: string, cb: () => Promise<void>) => {
        onceEventCallback = cb;
      }),
    };
    trader = new Trader();
    trader['getBroker'] = vi.fn().mockReturnValue(fakeBroker);
    trader['deferredEmit'] = vi.fn();
    trader['order'] = fakeOrder;
  });

  describe('constructor', () => {
    it.each`
      property                  | expectedValue
      ${'propogatedTrades'}     | ${0}
      ${'cancellingOrder'}      | ${false}
      ${'sendInitialPortfolio'} | ${false}
      ${'portfolio'}            | ${{ asset: 0, currency: 0 }}
      ${'balance'}              | ${0}
      ${'exposure'}             | ${0}
      ${'price'}                | ${0}
      ${'exposed'}              | ${false}
    `('should initialize $property to $expectedValue', ({ property, expectedValue }) => {
      expect(trader[property]).toEqual(expectedValue);
    });

    it('should call setInterval with synchronize and SYNCHRONIZATION_INTERVAL', () => {
      expect(setIntervalSpy).toHaveBeenCalledWith(trader['synchronize'], SYNCHRONIZATION_INTERVAL);
    });

    it('should call lodash bindAll with synchronize functions', () => {
      expect(bindAll).toHaveBeenCalledWith(trader, ['synchronize']);
    });
  });

  describe('synchronize', () => {
    it('should update price from ticker when price is 0', async () => {
      trader['price'] = 0;
      await trader['synchronize']();
      expect(trader['price']).toBe(100);
    });

    it('should call wait with the broker interval when price is 0', async () => {
      trader['price'] = 0;
      await trader['synchronize']();
      expect(wait).toHaveBeenCalledWith(50);
    });

    it('should NOT call fetchTicker if price is non-zero', async () => {
      trader['price'] = 200; // non-zero price bypasses ticker fetching
      await trader['synchronize']();
      expect(fakeBroker.fetchTicker).not.toHaveBeenCalled();
    });

    it('should update portfolio from broker', async () => {
      const newPortfolio = { asset: 2, currency: 100 };
      fakeBroker.fetchPortfolio.mockResolvedValue(newPortfolio);
      await trader['synchronize']();
      expect(trader['portfolio']).toEqual(newPortfolio);
    });

    it('should call setBalance', async () => {
      trader['setBalance'] = vi.fn();
      await trader['synchronize']();
      expect(trader['setBalance']).toHaveBeenCalled();
    });

    it('should emit portfolio change event if sendInitialPortfolio is true and portfolio changes', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['portfolio'] = { asset: 1, currency: 50 };
      const updatedPortfolio = { asset: 2, currency: 100 };
      fakeBroker.fetchPortfolio.mockResolvedValue(updatedPortfolio);
      trader['emitPortfolioChangeEvent'] = vi.fn();
      await trader['synchronize']();
      expect(trader['emitPortfolioChangeEvent']).toHaveBeenCalled();
    });

    it('should not emit portfolio change event if sendInitialPortfolio is true but portfolio is unchanged', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['portfolio'] = { asset: 1, currency: 50 };
      fakeBroker.fetchPortfolio.mockResolvedValue({ asset: 1, currency: 50 });
      trader['emitPortfolioChangeEvent'] = vi.fn();
      await trader['synchronize']();
      expect(trader['emitPortfolioChangeEvent']).not.toHaveBeenCalled();
    });
  });

  describe('emitPortfolioChangeEvent', () => {
    it('should call deferredEmit with PORTFOLIO_CHANGE_EVENT and correct portfolio data', () => {
      trader['portfolio'] = { asset: 5, currency: 15 };
      trader['emitPortfolioChangeEvent']();
      const portfolio = { asset: 5, currency: 15 };
      expect(trader['deferredEmit']).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, portfolio);
    });
  });

  describe('emitPortfolioValueChangeEvent', () => {
    it('should call deferredEmit with PORTFOLIO_VALUE_CHANGE_EVENT and correct balance data', () => {
      trader['balance'] = 1234.56;
      trader['emitPortfolioValueChangeEvent']();
      const balance = { balance: 1234.56 };
      expect(trader['deferredEmit']).toHaveBeenCalledWith(PORTFOLIO_VALUE_CHANGE_EVENT, balance);
    });
  });

  describe('setBalance', () => {
    it.each`
      property      | expected
      ${'balance'}  | ${0}
      ${'exposure'} | ${0}
      ${'exposed'}  | ${false}
    `('should leave $property unchanged when portfolio is empty', ({ property, expected }) => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 0 };
      trader['setBalance']();
      expect(trader[property]).toEqual(expected);
    });

    // For example, asset = 1, currency = 50, price = 100
    // Expected balance = 100*1 + 50 = 150
    // Expected exposure = (1*100) / 150 ≈ 0.66667, which is > 0.1 so exposed = true
    it.each`
      property      | expected
      ${'balance'}  | ${150}
      ${'exposure'} | ${100 / 150}
      ${'exposed'}  | ${true}
    `('should update $property correctly', ({ property, expected }) => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 1, currency: 50 };
      trader['setBalance']();
      expect(trader[property]).toBe(expected);
    });
  });

  describe('processOneMinuteCandle', () => {
    const fakeCandle = { close: 123 };

    it('should update the price with candle.close', async () => {
      // Stub synchronize so it does not affect our test.
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['price']).toBe(fakeCandle.close);
    });

    it('should call setBalance', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['setBalance'] = vi.fn();
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['setBalance']).toHaveBeenCalledWith();
    });

    it('should set sendInitialPortfolio to true when it was false', async () => {
      trader['sendInitialPortfolio'] = false;
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['sendInitialPortfolio']).toBe(true);
    });

    it('should call synchronize when sendInitialPortfolio is false', async () => {
      trader['sendInitialPortfolio'] = false;
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['synchronize']).toHaveBeenCalledWith();
    });

    it('should call deferredEmit with PORTFOLIO_CHANGE_EVENT when sendInitialPortfolio is false', async () => {
      trader['sendInitialPortfolio'] = false;
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      trader['portfolio'] = { asset: 10, currency: 20 };
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, {
        asset: trader['portfolio'].asset,
        currency: trader['portfolio'].currency,
      });
    });

    it('should call emitPortfolioValueChangeEvent if balance has changed', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['balance'] = 100;
      trader['setBalance'] = vi.fn(() => {
        trader['balance'] = 150;
      });
      trader['emitPortfolioValueChangeEvent'] = vi.fn();
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['emitPortfolioValueChangeEvent']).toHaveBeenCalled();
    });

    it('should NOT call emitPortfolioValueChangeEvent if balance remains unchanged', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['balance'] = 100;
      trader['setBalance'] = vi.fn(() => {
        trader['balance'] = 100;
      });
      trader['emitPortfolioValueChangeEvent'] = vi.fn();
      await trader['processOneMinuteCandle'](fakeCandle);
      expect(trader['emitPortfolioValueChangeEvent']).not.toHaveBeenCalled();
    });
  });

  describe('onStrategyAdvice', () => {
    it('should ignore advice with unknown recommendation', () => {
      const invalidAdvice = { recommendation: 'neutral', id: 'adv-invalid', date: Date.now() };
      trader.onStrategyAdvice(invalidAdvice);
      expect(error).toHaveBeenCalledWith('trader', 'Ignoring advice in unknown direction');
    });

    it('should ignore long advice if order already exists with same side', () => {
      trader['order'] = { getSide: () => 'buy' };
      trader['createOrder'] = vi.fn().mockImplementation(() => {});
      const advice = { recommendation: 'long', id: 'adv-long-same', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['createOrder']).not.toHaveBeenCalled();
    });

    it('should ignore short advice if order already exists with same side', () => {
      trader['order'] = { getSide: () => 'sell' };
      trader['createOrder'] = vi.fn().mockImplementation(() => {});
      const advice = { recommendation: 'short', id: 'adv-short-same', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['createOrder']).not.toHaveBeenCalled();
    });

    it('should ignore advice if already cancelling a previous order', () => {
      trader['order'] = { getSide: () => 'buy' };
      trader['cancellingOrder'] = true;
      trader['createOrder'] = vi.fn().mockImplementation(() => {});
      const advice = { recommendation: 'long', id: 'adv-cancelling', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['createOrder']).not.toHaveBeenCalled();
    });

    it('should cancel existing order if advice direction differs from current order', () => {
      trader['order'] = { getSide: () => 'sell' };
      trader['cancellingOrder'] = false;
      trader['cancelOrder'] = vi.fn();
      const advice = { recommendation: 'long', id: 'adv-diff-side', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['cancelOrder']).toHaveBeenCalled();
    });

    it('should abort buy trade if already exposed', () => {
      trader['order'] = undefined;
      trader['exposed'] = true;
      trader['portfolio'] = { asset: 0, currency: 100 };
      trader['balance'] = 50;
      const advice = { recommendation: 'long', id: 'adv-buy-abort', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_ABORTED_EVENT, {
        id: 'trade-1',
        adviceId: advice.id,
        action: 'buy',
        portfolio: trader['portfolio'],
        balance: trader['balance'],
        reason: 'Portfolio already in position.',
        date: advice.date,
      });
    });

    it('should create buy order when not exposed', () => {
      trader['order'] = undefined;
      trader['exposed'] = false;
      trader['portfolio'] = { asset: 0, currency: 200 };
      trader['price'] = 100;
      trader['createOrder'] = vi.fn().mockImplementation(() => {});
      const advice = { recommendation: 'long', id: 'adv-buy-create', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['createOrder']).toHaveBeenCalledWith('buy', 1.9, advice, 'trade-1');
    });

    it('should abort sell trade if not exposed', () => {
      trader['order'] = undefined;
      trader['exposed'] = false;
      trader['portfolio'] = { asset: 5, currency: 50 };
      trader['balance'] = 100;
      const advice = { recommendation: 'short', id: 'adv-sell-abort', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_ABORTED_EVENT, {
        id: 'trade-1',
        adviceId: advice.id,
        action: 'sell',
        portfolio: trader['portfolio'],
        balance: trader['balance'],
        reason: 'Portfolio already in position.',
        date: advice.date,
      });
    });

    it('should create sell order when exposed', () => {
      trader['order'] = undefined;
      trader['exposed'] = true;
      trader['portfolio'] = { asset: 3, currency: 50 };
      trader['createOrder'] = vi.fn();
      const advice = { recommendation: 'short', id: 'adv-sell-create', date: Date.now() };
      trader.onStrategyAdvice(advice);
      expect(trader['createOrder']).toHaveBeenCalledWith('sell', 3, advice, 'trade-1');
    });
  });

  describe('cancelOrder', () => {
    it('should call the callback immediately if no order exists', () => {
      trader['order'] = undefined;
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      expect(callback).toHaveBeenCalled();
    });

    it('should set cancellingOrder to true when order exists', () => {
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      expect(trader['cancellingOrder']).toBe(true);
    });

    it('should call order.removeAllListeners when order exists', () => {
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      expect(fakeOrder.removeAllListeners).toHaveBeenCalled();
    });

    it('should call order.cancel when order exists', () => {
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      expect(fakeOrder.cancel).toHaveBeenCalled();
    });

    it('should clear order after ORDER_COMPLETED_EVENT is triggered', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      await onceEventCallback();
      expect(trader['order']).toBeUndefined();
    });

    it('should set cancellingOrder to false after ORDER_COMPLETED_EVENT is triggered', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      await onceEventCallback();
      expect(trader['cancellingOrder']).toBe(false);
    });

    it('should emit TRADE_CANCELED_EVENT with correct payload after ORDER_COMPLETED_EVENT is triggered', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      const callback = vi.fn();
      const fixedTime = 123456789;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      await onceEventCallback();
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_CANCELED_EVENT, {
        id: 'test-id',
        adviceId: 'adv1',
        date: fixedTime,
      });
    });

    it('should call synchronize after ORDER_COMPLETED_EVENT is triggered', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      await onceEventCallback();
      expect(trader['synchronize']).toHaveBeenCalled();
    });

    it('should call the provided callback after ORDER_COMPLETED_EVENT is triggered', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      const callback = vi.fn();
      trader['cancelOrder']('test-id', { id: 'adv1' }, callback);
      await onceEventCallback();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    const advice = { id: 'adv1', date: 1609459200000 };
    const orderId = 'trade-1';
    const side = 'buy';
    const amount = 2;

    beforeEach(() => {
      trader['order'] = new StickyOrder('buy', 0, fakeBroker as unknown as Broker);
    });

    it('should emit TRADE_INITIATED_EVENT with correct payload', async () => {
      await trader['createOrder'](side, amount, advice, orderId);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_INITIATED_EVENT, {
        id: orderId,
        adviceId: advice.id,
        action: side,
        portfolio: trader['portfolio'],
        balance: trader['balance'],
        date: advice.date,
      });
    });

    it('should log error when ORDER_ERRORED_EVENT is emitted', async () => {
      await trader['createOrder'](side, amount, advice, orderId);
      trader['order']._events[ORDER_ERRORED_EVENT]('error reason');
      expect(error).toHaveBeenCalledWith('trader', 'Gekko received error: error reason');
    });

    it('should clear trader.order when ORDER_ERRORED_EVENT is emitted', async () => {
      await trader['createOrder'](side, amount, advice, orderId);
      trader['order']._events[ORDER_ERRORED_EVENT]('error reason');
      expect(trader['order']).toBeUndefined();
    });

    it('should set cancellingOrder to false when ORDER_ERRORED_EVENT is emitted', async () => {
      await trader['createOrder'](side, amount, advice, orderId);
      trader['cancellingOrder'] = true;
      trader['order']._events[ORDER_ERRORED_EVENT]('error reason');
      expect(trader['cancellingOrder']).toBe(false);
    });

    it('should emit TRADE_ERRORED_EVENT with correct payload on order error', async () => {
      const fixedTime = 1609459300000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
      await trader['createOrder'](side, amount, advice, orderId);
      trader['order']._events[ORDER_ERRORED_EVENT]('error reason');
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_ERRORED_EVENT, {
        id: orderId,
        adviceId: advice.id,
        date: fixedTime,
        reason: 'error reason',
      });
    });

    it('should call handleOrderCompletedEvent on ORDER_COMPLETED_EVENT', async () => {
      trader['handleOrderCompletedEvent'] = vi.fn();
      await trader['createOrder'](side, amount, advice, orderId);
      await trader['order']._events[ORDER_COMPLETED_EVENT]();
      expect(trader['handleOrderCompletedEvent']).toHaveBeenCalledWith(advice, orderId);
    });

    it('should log error if handleOrderCompletedEvent throws an error on ORDER_COMPLETED_EVENT', async () => {
      const errorMessage = 'handle error';
      trader['handleOrderCompletedEvent'] = vi.fn().mockImplementation(() => {
        throw new Error(errorMessage);
      });
      await trader['createOrder'](side, amount, advice, orderId);
      await trader['order']._events[ORDER_COMPLETED_EVENT]();
      expect(error).toHaveBeenCalledWith('trader', errorMessage);
    });

    it('should emit TRADE_ERRORED_EVENT with correct payload if handleOrderCompletedEvent throws an error', async () => {
      const errorMessage = 'handle error';
      trader['handleOrderCompletedEvent'] = vi.fn().mockImplementation(() => {
        throw new Error(errorMessage);
      });
      const fixedTime = 1609459400000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
      await trader['createOrder'](side, amount, advice, orderId);
      await trader['order']._events[ORDER_COMPLETED_EVENT]();
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_ERRORED_EVENT, {
        id: orderId,
        adviceId: advice.id,
        date: fixedTime,
        reason: errorMessage,
      });
    });
  });

  describe('processCostAndPrice', () => {
    it('should calculate cost and effectivePrice for buy with feePercent provided', () => {
      const side = 'buy';
      const price = 100;
      const amount = 2;
      const feePercent = 1; // 1%
      // Expected cost = (1/100) * 2 * 100 = 2,
      // Expected effectivePrice = 100 * (1 + 1/100) = 101.
      const result = trader['processCostAndPrice'](side, price, amount, feePercent);
      expect(result).toEqual({ effectivePrice: 101, cost: 2 });
    });

    it('should calculate cost and effectivePrice for sell with feePercent provided', () => {
      const side = 'sell';
      const price = 100;
      const amount = 2;
      const feePercent = 1; // 1%
      // Expected cost = (1/100) * 2 * 100 = 2,
      // Expected effectivePrice = 100 * (1 - 1/100) = 99.
      const result = trader['processCostAndPrice'](side, price, amount, feePercent);
      expect(result).toEqual({ effectivePrice: 99, cost: 2 });
    });

    it('should handle a feePercent of 0 correctly', () => {
      const side = 'buy';
      const price = 100;
      const amount = 2;
      const feePercent = 0;
      const result = trader['processCostAndPrice'](side, price, amount, feePercent);
      expect(result).toEqual({ effectivePrice: 100, cost: 0 });
    });

    it('should calculate cost and effectivePrice when feePercent is not provided', () => {
      const side = 'buy'; // side doesn't matter in this branch
      const price = 100;
      const amount = 2;
      // Expected effectivePrice = price = 100,
      // Expected cost = 100 * 2 = 200.
      const result = trader['processCostAndPrice'](side, price, amount);
      expect(result).toEqual({ effectivePrice: 100, cost: 200 });
    });

    it('should log warning when feePercent is not provided', () => {
      const side = 'buy';
      const price = 100;
      const amount = 2;
      trader['processCostAndPrice'](side, price, amount);
      expect(warning).toHaveBeenCalledWith('trader', 'Exchange did not provide fee information, assuming no fees..');
    });
  });

  describe('handleOrderCompletedEvent', () => {
    it('should throw PluginError when order is missing', async () => {
      trader['order'] = undefined;
      let error;
      try {
        await trader['handleOrderCompletedEvent']({ id: 'adv1' }, 'trade-1');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(GekkoError);
    });

    it('should clear order after handling the completed event', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      trader['processCostAndPrice'] = vi.fn().mockReturnValue({ effectivePrice: 101, cost: 2 });
      await trader['handleOrderCompletedEvent']({ id: 'adv2' }, 'trade-1');
      expect(trader['order']).toBeUndefined();
    });

    it('should call synchronize after handling the completed event', async () => {
      const syncSpy = vi.fn(() => Promise.resolve());
      trader['synchronize'] = syncSpy;
      trader['processCostAndPrice'] = vi.fn().mockReturnValue({ effectivePrice: 101, cost: 2 });
      await trader['handleOrderCompletedEvent']({ id: 'adv3' }, 'trade-1');
      expect(syncSpy).toHaveBeenCalled();
    });

    it('should call processCostAndPrice with summary values', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      trader['processCostAndPrice'] = vi.fn().mockReturnValue({ effectivePrice: 101, cost: 2 });
      await trader['handleOrderCompletedEvent']({ id: 'adv4' }, 'trade-1');
      expect(trader['processCostAndPrice']).toHaveBeenCalledWith(
        summary.side,
        summary.price,
        summary.amount,
        summary.feePercent,
      );
    });

    it('should emit TRADE_COMPLETED_EVENT with correct payload', async () => {
      trader['synchronize'] = vi.fn(() => Promise.resolve());
      trader['portfolio'] = { asset: 1, currency: 50 };
      trader['balance'] = 150;
      trader['processCostAndPrice'] = vi.fn().mockReturnValue({ effectivePrice: 101, cost: 2 });
      await trader['handleOrderCompletedEvent']({ id: 'adv5' }, 'trade-1');
      expect(trader['deferredEmit']).toHaveBeenCalledWith(TRADE_COMPLETED_EVENT, {
        id: 'trade-1',
        adviceId: 'adv5',
        action: summary.side,
        cost: 2,
        amount: summary.amount,
        price: summary.price,
        portfolio: trader['portfolio'],
        balance: trader['balance'],
        date: summary.date,
        feePercent: summary.feePercent,
        effectivePrice: 101,
      });
    });
  });

  describe('processFinalize', () => {
    it('should clear sync interval if it exists', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      trader['syncInterval'] = setInterval(() => {}, 100);
      const interval = trader['syncInterval'];
      trader['processFinalize']();
      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
      expect(trader['syncInterval']).toBeUndefined();
    });
  });

  describe('getStaticConfiguration', () => {
    it('should return a configuration object with schema equal to traderSchema', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.schema).toBe(traderSchema);
    });

    it('should return a configuration object with modes equal to ["realtime"]', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.modes).toEqual(['realtime']);
    });

    it('should return a configuration object with dependencies as an empty array', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.dependencies).toEqual([]);
    });

    it('should return a configuration object with inject equal to ["broker"]', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.inject).toEqual(['broker']);
    });

    it('should return a configuration object with all eventsHandlers', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.eventsHandlers).toEqual(['onStrategyAdvice']);
    });

    it('should return a configuration object with eventsEmitted equal to the expected array', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.eventsEmitted).toEqual([
        PORTFOLIO_CHANGE_EVENT,
        PORTFOLIO_VALUE_CHANGE_EVENT,
        TRADE_ABORTED_EVENT,
        TRADE_CANCELED_EVENT,
        TRADE_COMPLETED_EVENT,
        TRADE_ERRORED_EVENT,
        TRADE_INITIATED_EVENT,
      ]);
    });

    it('should return a configuration object with name equal to Trader.name', () => {
      const config = Trader.getStaticConfiguration();
      expect(config.name).toEqual(Trader.name);
    });
  });
});
