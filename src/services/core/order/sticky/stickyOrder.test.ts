import { Order } from '@models/types/order.types';
import { Broker } from '@services/broker/broker';
import { toTimestamp } from '@utils/date/date.utils';
import { InvalidOrder, OrderNotFound } from 'ccxt';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderOutOfRangeError } from '../../../../errors/broker/OrderOutRange.error';
import { OrderError } from '../../../../errors/order/order.error';
import { warning } from '../../../logger';
import { StickyOrder } from './stickyOrder';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const fakeBroker = {
  createLimitOrder: vi.fn(),
  cancelLimitOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyTrades: vi.fn(),
  fetchTicker: vi.fn(),
  getInterval: vi.fn(() => 50),
};

vi.useFakeTimers();

describe('StickyOrder', () => {
  let stickyOrder: StickyOrder;
  const defaultOrder: Order = { id: 'new-id', status: 'open', filled: 0, price: 100, timestamp: toTimestamp('2025') };

  beforeEach(() => {
    fakeBroker.createLimitOrder.mockResolvedValue(defaultOrder);
    stickyOrder = new StickyOrder('buy', 10, fakeBroker as unknown as Broker);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create an initial order', async () => {
      expect(fakeBroker.createLimitOrder).toHaveBeenCalledWith('buy', 10);
    });
    it('should set an interval', async () => {
      expect(stickyOrder['interval']).toBeDefined();
    });
  });

  describe('cancel', () => {
    it.each`
      condition               | setup
      ${'order completed'}    | ${(order: StickyOrder) => order['setStatus']('filled')}
      ${'order initializing'} | ${(order: StickyOrder) => order['setStatus']('initializing')}
      ${'checking flag'}      | ${(order: StickyOrder) => (order['checking'] = true)}
    `('should return early and not call cancelOrder if $condition', async ({ setup }) => {
      stickyOrder['cancelOrder'] = vi.fn();
      setup(stickyOrder);
      await stickyOrder.cancel();
      expect(stickyOrder['cancelOrder']).not.toHaveBeenCalled();
    });
    it('should return early and not call cancelOrder if id is not set', async () => {
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['id'] = undefined;
      await stickyOrder.cancel();
      expect(stickyOrder['cancelOrder']).not.toHaveBeenCalled();
    });
    describe('when order status is non-error', () => {
      it('should call cancelOrder with the order id', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['id'] = 'order-test';
        stickyOrder['setStatus']('open');
        await stickyOrder.cancel();
        expect(stickyOrder['cancelOrder']).toHaveBeenCalledWith('order-test');
      });

      it('should clear the interval', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['setStatus']('open');
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
        await stickyOrder.cancel();
        expect(clearIntervalSpy).toHaveBeenCalledWith(stickyOrder['interval']);
      });

      it('should reset the completing flag to false', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['setStatus']('open');
        await stickyOrder.cancel();
        expect(stickyOrder['completing']).toBe(false);
      });
    });
    describe('when order status is error', () => {
      it('should call cancelOrder with the order id', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['id'] = 'order-test';
        stickyOrder['setStatus']('error');
        await stickyOrder.cancel();
        expect(stickyOrder['cancelOrder']).toHaveBeenCalledWith('order-test');
      });

      it('should not clear the interval', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['setStatus']('error');
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
        await stickyOrder.cancel();
        expect(clearIntervalSpy).not.toHaveBeenCalled();
      });

      it('should keep the completing flag true', async () => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['setStatus']('error');
        await stickyOrder.cancel();
        expect(stickyOrder['completing']).toBe(true);
      });
    });
  });

  describe('move', () => {
    it('should NOT call cancelOrder when completing flag is true', async () => {
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['completing'] = true;
      await stickyOrder['move']();
      expect(stickyOrder['cancelOrder']).not.toHaveBeenCalled();
    });

    it('should NOT call cancelOrder when id is undefined', async () => {
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['id'] = undefined;
      await stickyOrder['move']();
      expect(stickyOrder['cancelOrder']).not.toHaveBeenCalled();
    });

    it('should call cancelOrder when id is defined', async () => {
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['createOrder'] = vi.fn();
      stickyOrder['id'] = 'order-move-test';
      await stickyOrder['move']();
      expect(stickyOrder['cancelOrder']).toHaveBeenCalledWith('order-move-test');
    });

    it.each`
      filledAmount | expectedAmount
      ${0}         | ${10}
      ${2}         | ${8}
      ${5}         | ${5}
    `(
      'should call createOrder with computed amount when filledAmount is $filledAmount (amount: $expectedAmount)',
      async ({ filledAmount, expectedAmount }) => {
        stickyOrder['cancelOrder'] = vi.fn();
        stickyOrder['createOrder'] = vi.fn();
        stickyOrder['id'] = 'order-move-test';
        stickyOrder['amount'] = 10;
        stickyOrder['transactions'] = [{ id: 'tx1', filled: filledAmount, timestamp: 1710000000000 }];
        await stickyOrder['move']();
        expect(stickyOrder['createOrder']).toHaveBeenCalledWith('buy', expectedAmount);
      },
    );

    it('should NOT call createOrder when status is error', async () => {
      stickyOrder['createOrder'] = vi.fn();
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['id'] = 'order-move-test';
      stickyOrder['status'] = 'error';
      await stickyOrder['move']();
      expect(stickyOrder['createOrder']).not.toHaveBeenCalled();
    });

    it.each`
      status
      ${'filled'}
      ${'canceled'}
      ${'rejected'}
    `('should NOT call createOrder when status is $status', async ({ status }) => {
      stickyOrder['createOrder'] = vi.fn();
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['id'] = 'order-move-test';
      stickyOrder['status'] = status;
      await stickyOrder['move']();
      expect(stickyOrder['createOrder']).not.toHaveBeenCalled();
    });

    it('should always set moving flag to false after execution', async () => {
      stickyOrder['cancelOrder'] = vi.fn();
      stickyOrder['createOrder'] = vi.fn();
      stickyOrder['id'] = 'order-move-test';
      await stickyOrder['move']();
      expect(stickyOrder['moving']).toBe(false);
    });
  });

  describe('checkOrder', () => {
    it.each`
      status
      ${'filled'}
      ${'canceled'}
      ${'rejected'}
    `('should call cancel when order is completed with status $status', async ({ status }) => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['cancel'] = vi.fn();
      stickyOrder['status'] = status;
      await stickyOrder['checkOrder']();
      expect(stickyOrder.cancel).toHaveBeenCalled();
    });

    it('should call cancel when completing flag is true', async () => {
      stickyOrder['cancel'] = vi.fn();
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['completing'] = true;
      await stickyOrder['checkOrder']();
      expect(stickyOrder.cancel).toHaveBeenCalled();
    });

    it('should NOT call fetchOrder when status is initializing', async () => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['setStatus']('initializing');
      await stickyOrder['checkOrder']();
      expect(stickyOrder['fetchOrder']).not.toHaveBeenCalled();
    });

    it('should NOT call fetchOrder when checking flag is already true', async () => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['checking'] = true;
      await stickyOrder['checkOrder']();
      expect(stickyOrder['fetchOrder']).not.toHaveBeenCalled();
    });

    it('should NOT call fetchOrder when id is not defined under normal conditions', async () => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['setStatus']('open');
      stickyOrder['checking'] = false;
      stickyOrder['id'] = undefined;
      await stickyOrder['checkOrder']();
      expect(stickyOrder['fetchOrder']).not.toHaveBeenCalled();
    });

    it('should call fetchOrder with id when conditions are normal', async () => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['setStatus']('open');
      stickyOrder['checking'] = false;
      stickyOrder['id'] = 'order-check-test';
      await stickyOrder['checkOrder']();
      expect(stickyOrder['fetchOrder']).toHaveBeenCalledWith('order-check-test');
    });

    it('should reset checking flag to false after execution', async () => {
      stickyOrder['fetchOrder'] = vi.fn();
      stickyOrder['setStatus']('open');
      stickyOrder['checking'] = false;
      await stickyOrder['checkOrder']();
      expect(stickyOrder['checking']).toBe(false);
    });
  });

  describe('isOrderPartiallyFilled', () => {
    it.each`
      status        | transactions       | expected
      ${'open'}     | ${[{ filled: 5 }]} | ${true}
      ${'open'}     | ${[{ filled: 0 }]} | ${false}
      ${'filled'}   | ${[{ filled: 5 }]} | ${false}
      ${'canceled'} | ${[{ filled: 5 }]} | ${false}
      ${'rejected'} | ${[{ filled: 5 }]} | ${false}
      ${'open'}     | ${[]}              | ${false}
    `(
      'should return $expected when status is $status and transactions is $transactions',
      ({ status, transactions, expected }) => {
        stickyOrder['setStatus'](status);
        stickyOrder['transactions'] = transactions;
        expect(stickyOrder['isOrderPartiallyFilled']()).toBe(expected);
      },
    );
  });

  describe('isOrderCompleted', () => {
    it.each`
      status            | expected
      ${'filled'}       | ${true}
      ${'canceled'}     | ${true}
      ${'rejected'}     | ${true}
      ${'initializing'} | ${false}
      ${'open'}         | ${false}
      ${'error'}        | ${false}
    `('should return $expected when status is $status', ({ status, expected }) => {
      stickyOrder['setStatus'](status);
      expect(stickyOrder['isOrderCompleted']()).toBe(expected);
    });
  });

  describe('handleCreateOrderSuccess', () => {
    it('should filter old transaction if not filled', () => {
      stickyOrder['transactions'] = [{ id: 'tx1', filled: 0, timestamp: 1710000000000 }];
      stickyOrder['id'] = 'tx1';
      stickyOrder['handleCreateOrderSuccess']({
        id: 'new-id',
        status: 'open',
        filled: 0,
        timestamp: 1710000000000,
      });
      expect(stickyOrder['transactions']).toHaveLength(1);
    });

    it('should append the new transaction', () => {
      stickyOrder['handleCreateOrderSuccess']({
        id: 'new-id',
        status: 'open',
        filled: 0,
        timestamp: 1710000000000,
      });
      const hasNewTransaction = stickyOrder['transactions'].some(
        t => t.id === 'new-id' && t.timestamp === 1710000000000 && t.filled === 0,
      );
      expect(hasNewTransaction).toBeTruthy();
    });

    it('should update the order id to the new id', () => {
      stickyOrder['handleCreateOrderSuccess'](defaultOrder);
      expect(stickyOrder['id']).toBe('new-id');
    });

    it.each`
      status
      ${'closed'}
      ${'canceled'}
    `('should call clearInterval when status is "$status"', ({ status }) => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should call orderFilled when status is "closed"', () => {
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status: 'closed' });
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it('should call orderPartiallyFilled when status is "open" and filled is nonzero', () => {
      stickyOrder['orderPartiallyFilled'] = vi.fn();
      stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status: 'open', filled: 5 });
      expect(stickyOrder['orderPartiallyFilled']).toHaveBeenCalledWith('new-id', 5);
    });

    it.each`
      filled | expectedArg
      ${0}   | ${false}
      ${5}   | ${true}
    `(
      'should call orderCanceled with $expectedArg when status is "canceled" and filled is $filled',
      ({ filled, expectedArg }) => {
        stickyOrder['orderCanceled'] = vi.fn();
        stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status: 'canceled', filled });
        expect(stickyOrder['orderCanceled']).toHaveBeenCalledWith(expectedArg);
      },
    );

    it('should call setStatus with "open" when status is "open"', () => {
      stickyOrder['setStatus'] = vi.fn();
      stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status: 'open' });
      expect(stickyOrder['setStatus']).toHaveBeenCalledWith('open');
    });

    it('should log a warning when status is unknown', () => {
      stickyOrder['handleCreateOrderSuccess']({ ...defaultOrder, status: 'unknown' } as unknown as Order);
      expect(warning).toHaveBeenCalled();
    });
  });

  describe('handleCreateOrderError', () => {
    it('should call clearInterval', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const error = new Error('generic error');
      try {
        stickyOrder['handleCreateOrderError'](error);
      } catch {
        // Error is expected to be thrown.
      }
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should call orderFilled when error is OrderOutOfRangeError and order is partially filled', () => {
      const error = new OrderOutOfRangeError('amount', 10, 1, 100);
      stickyOrder['isOrderPartiallyFilled'] = vi.fn().mockReturnValue(true);
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['handleCreateOrderError'](error);
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it.each`
      errorInstance                                     | isPartiallyFilled
      ${new OrderOutOfRangeError('amount', 10, 1, 100)} | ${false}
      ${new InvalidOrder('invalid order')}              | ${false}
    `(
      'should emit an invalid event and call orderRejected when error is $errorInstance',
      ({ errorInstance, isPartiallyFilled }) => {
        stickyOrder['isOrderPartiallyFilled'] = vi.fn().mockReturnValue(isPartiallyFilled);
        stickyOrder['orderRejected'] = vi.fn();
        stickyOrder['handleCreateOrderError'](errorInstance);
        expect(stickyOrder['orderRejected']).toHaveBeenCalledWith(errorInstance.message);
      },
    );

    it('should call orderErrored when error is a generic Error', () => {
      const error = new Error('generic error');
      stickyOrder['orderErrored'] = vi.fn();
      try {
        stickyOrder['handleCreateOrderError'](error);
      } catch {
        // Error is expected to be thrown.
      }
      expect(stickyOrder['orderErrored']).toHaveBeenCalledWith(error);
    });

    it('should throw the error if it is a generic Error', () => {
      const error = new Error('generic error');
      expect(() => stickyOrder['handleCreateOrderError'](error)).toThrow('generic error');
    });
  });

  describe('handleCancelOrderSuccess', () => {
    it('should call orderFilled when remaining is 0', () => {
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'order-id-1', filled: 3, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, remaining: 0 });
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it('should call clearInterval when remaining is 0', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'order-id-1', filled: 3, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, remaining: 0 });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should call orderFilled when filled equals the total order amount', () => {
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['amount'] = 5;
      stickyOrder['transactions'] = [{ id: 'order-id-1', filled: 2, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, filled: 3 });
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it('should call clearInterval when filled equals the total order amount', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      stickyOrder['orderFilled'] = vi.fn();
      stickyOrder['amount'] = 5;
      stickyOrder['transactions'] = [{ id: 'order-id-1', filled: 2, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, filled: 3 });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should call updateTransactionPartialFilledAmount when filled is greater than the total filled amount', () => {
      stickyOrder['updateTransactionPartialFilledAmount'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'test', filled: 3, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, filled: 5, remaining: 10 });
      expect(stickyOrder['updateTransactionPartialFilledAmount']).toHaveBeenCalled();
    });

    it('should call orderCanceled when no prior branch is triggered and moving is false', () => {
      stickyOrder['orderCanceled'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'test', filled: 2, timestamp: 1710000000000 }];
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, filled: 1, remaining: 10 });
      expect(stickyOrder['orderCanceled']).toHaveBeenCalledWith(true);
    });

    it('should NOT call orderCanceled when the moving flag is true', () => {
      stickyOrder['orderCanceled'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'test', filled: 2, timestamp: 1710000000000 }];
      stickyOrder['moving'] = true;
      stickyOrder['handleCancelOrderSuccess']({ ...defaultOrder, filled: 1, remaining: 10 });
      expect(stickyOrder['orderCanceled']).not.toHaveBeenCalled();
    });
  });

  describe('handleCancelOrderError', () => {
    it('should call clearInterval when error is OrderNotFound', async () => {
      const error = new OrderNotFound('Order not found');
      stickyOrder['orderFilled'] = vi.fn();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await stickyOrder['handleCancelOrderError'](error);
      expect(clearIntervalSpy).toHaveBeenCalledWith(stickyOrder['interval']);
    });
    it('should call orderFilled when error is OrderNotFound', async () => {
      const error = new OrderNotFound('Order not found');
      stickyOrder['orderFilled'] = vi.fn();
      await stickyOrder['handleCancelOrderError'](error);
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it('should call orderErrored when error is a generic Error', async () => {
      const error = new Error('Some error');
      stickyOrder['orderErrored'] = vi.fn();
      await stickyOrder['handleCancelOrderError'](error);
      expect(stickyOrder['orderErrored']).toHaveBeenCalledWith(error);
    });
  });

  describe('handleFetchOrderSuccess', () => {
    it('should call clearInterval when status is "closed"', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      stickyOrder['orderFilled'] = vi.fn();
      await stickyOrder['handleFetchOrderSuccess']({
        ...defaultOrder,
        status: 'closed',
      });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should call orderFilled when status is "closed"', async () => {
      stickyOrder['orderFilled'] = vi.fn();
      await stickyOrder['handleFetchOrderSuccess']({ ...defaultOrder, status: 'closed' });
      expect(stickyOrder['orderFilled']).toHaveBeenCalled();
    });

    it('should call updateTransactionPartialFilledAmount', async () => {
      stickyOrder['updateTransactionPartialFilledAmount'] = vi.fn();
      await stickyOrder['handleFetchOrderSuccess']({ ...defaultOrder, status: 'canceled', filled: 5 });
      expect(stickyOrder['updateTransactionPartialFilledAmount']).toHaveBeenCalled();
    });

    it('should call clearInterval when status is "closed"', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      stickyOrder['orderCanceled'] = vi.fn();
      await stickyOrder['handleFetchOrderSuccess']({ ...defaultOrder, status: 'canceled' });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it.each`
      filled
      ${0}
      ${5}
    `('should call orderCanceled when status is "canceled" and filled is $filled', async ({ filled }) => {
      stickyOrder['orderCanceled'] = vi.fn();
      await stickyOrder['handleFetchOrderSuccess']({ ...defaultOrder, status: 'canceled', filled });
      expect(stickyOrder['orderCanceled']).toHaveBeenCalledWith(!!filled);
    });

    it('should call move when status is "open" and ticker price mismatches order price', async () => {
      stickyOrder['move'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'test-id', filled: 5, timestamp: 1710000000000 }];
      fakeBroker.fetchTicker.mockResolvedValue({ bid: 101, ask: 99 });
      await stickyOrder['handleFetchOrderSuccess']({
        ...defaultOrder,
        status: 'open',
        filled: 5,
        price: 100,
      });
      expect(stickyOrder['move']).toHaveBeenCalled();
    });

    it('should NOT call move when status is "open" and ticker price matches order price', async () => {
      stickyOrder['move'] = vi.fn();
      stickyOrder['transactions'] = [{ id: 'test-id', filled: 5, timestamp: 1710000000000 }];
      fakeBroker.fetchTicker.mockResolvedValue({ bid: 100, ask: 99 });
      await stickyOrder['handleFetchOrderSuccess']({ ...defaultOrder, status: 'open', price: 100 });
      expect(stickyOrder['move']).not.toHaveBeenCalled();
    });

    it('should rethrow error when fetchTicker fails', async () => {
      const testError = new Error('Ticker fetch failed');
      fakeBroker.fetchTicker.mockRejectedValue(testError);
      await expect(stickyOrder['handleFetchOrderSuccess'](defaultOrder)).rejects.toThrow('Ticker fetch failed');
    });

    it('should call orderErrored when fetchTicker fails', async () => {
      stickyOrder['orderErrored'] = vi.fn();
      const testError = new Error('Ticker fetch failed');
      fakeBroker.fetchTicker.mockRejectedValue(testError);
      try {
        await stickyOrder['handleFetchOrderSuccess'](defaultOrder);
      } catch {
        // In catch block, assert that orderErrored was called.
        expect(stickyOrder['orderErrored']).toHaveBeenCalledWith(testError);
      }
    });
  });

  describe('createSummary', () => {
    it('should throw an error if the order is not completed', async () => {
      stickyOrder['isOrderCompleted'] = vi.fn().mockReturnValue(false);
      await expect(stickyOrder.createSummary()).rejects.toThrow(OrderError);
    });

    it('should throw an error if no trades are found', async () => {
      stickyOrder['isOrderCompleted'] = vi.fn().mockReturnValue(true);
      fakeBroker.fetchMyTrades.mockResolvedValue([]);
      await expect(stickyOrder.createSummary()).rejects.toThrow('No trades found in order');
    });

    it('should return a summary with correct values', async () => {
      stickyOrder['isOrderCompleted'] = vi.fn().mockReturnValue(true);
      stickyOrder['transactions'] = [{ id: 'order-1', timestamp: Date.now() }];

      fakeBroker.fetchMyTrades.mockResolvedValue([
        { order: 'order-1', amount: 2, price: 100, fee: { rate: 0.01 }, timestamp: 1710000000000 },
        { order: 'order-1', amount: 3, price: 105, fee: { rate: 0.015 }, timestamp: 1710000100000 },
      ]);

      const summary = await stickyOrder.createSummary();

      expect(summary).toStrictEqual({
        amount: 5,
        price: 103,
        feePercent: 0.013,
        side: 'buy',
        date: 1710000100000,
      });
    });
  });

  describe('updateTransactionPartialFilledAmount', () => {
    beforeEach(() => {
      stickyOrder['transactions'] = [
        { id: 'tx1', filled: 2, timestamp: 1710000000000 },
        { id: 'tx2', filled: 5, timestamp: 1710000100000 },
      ];
      stickyOrder['orderPartiallyFilled'] = vi.fn();
    });

    it('should update the filled amount if new value is greater', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx1', 3);
      expect(stickyOrder['transactions'].find(t => t.id === 'tx1')?.filled).toBe(3);
    });

    it('should call orderPartiallyFilled if new value is greater', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx1', 3);
      expect(stickyOrder['orderPartiallyFilled']).toHaveBeenCalledWith('tx1', 3);
    });

    it('should NOT update the filled amount if new value is less or equal', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx1', 2);
      expect(stickyOrder['transactions'].find(t => t.id === 'tx1')?.filled).toBe(2);
    });

    it('should NOT call orderPartiallyFilled if new value is less or equal', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx1', 2);
      expect(stickyOrder['orderPartiallyFilled']).not.toHaveBeenCalled();
    });

    it('should NOT update if the transaction id does NOT exist', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx3', 4);
      expect(stickyOrder['transactions']).toHaveLength(2);
    });

    it('should NOT call orderPartiallyFilled if the transaction id does NOT exist and filled 0', () => {
      stickyOrder['updateTransactionPartialFilledAmount']('tx3', 0);
      expect(stickyOrder['orderPartiallyFilled']).not.toHaveBeenCalled();
    });
  });
});
