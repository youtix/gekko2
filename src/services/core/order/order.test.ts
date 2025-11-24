import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@constants/event.const';
import { OrderState } from '@models/order.types';
import { toTimestamp } from '@utils/date/date.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Order } from './order';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const fakeExchange = {
  createLimitOrder: vi.fn(),
  createMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchTicker: vi.fn(),
  getInterval: vi.fn(() => 50),
};

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: () => fakeExchange,
  },
}));

class TestOrder extends Order {
  public handleCancelOrderSuccess = vi.fn();
  public handleCancelOrderError = vi.fn();
  public handleCreateOrderSuccess = vi.fn();
  public handleCreateOrderError = vi.fn();
  public handleFetchOrderSuccess = vi.fn();
  public handleFetchOrderError = vi.fn();
  public cancel = vi.fn();
  public createSummary = vi.fn();
  public checkOrder = vi.fn();
  public launch = vi.fn();
}

describe('order', () => {
  const defaultOrder: OrderState = {
    id: 'tx1',
    status: 'open',
    filled: 0,
    price: 100,
    timestamp: toTimestamp('2025'),
  };
  let testOrder: TestOrder;

  beforeEach(() => {
    Object.values(fakeExchange).forEach(value => {
      if (typeof value === 'function') value.mockReset?.();
    });
    testOrder = new TestOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', 'BUY', 'STICKY');
  });

  it('should have status "initializing" upon creation', () => {
    expect(testOrder['getStatus']()).toBe('initializing');
  });

  describe('setStatus', () => {
    it('should update status when setStatus is called', () => {
      testOrder['setStatus']('open');
      expect(testOrder['getStatus']()).toBe('open');
    });

    it('should emit a ORDER_STATUS_CHANGED_EVENT when setStatus is called', () => {
      const spy = vi.spyOn(testOrder, 'emit');
      testOrder['setStatus']('open');
      expect(spy).toHaveBeenCalledWith(ORDER_STATUS_CHANGED_EVENT, {
        status: 'open',
        reason: undefined,
      });
    });
  });

  describe('orderCanceled', () => {
    it('should call setStatus with "canceled" and emit ORDER_CANCELED_EVENT on orderCanceled', () => {
      const spy = vi.spyOn(testOrder, 'emit');
      testOrder['orderCanceled']({ filled: 100, remaining: 5, price: 10, timestamp: 0 });
      expect(spy).toHaveBeenCalledWith(ORDER_CANCELED_EVENT, {
        status: 'canceled',
        filled: 100,
        remaining: 5,
        price: 10,
        timestamp: 0,
      });
    });
  });

  describe('orderRejected', () => {
    it('should call setStatus with "rejected" and emit ORDER_INVALID_EVENT with filled false and a reason', () => {
      const spy = vi.spyOn(testOrder, 'emit');
      testOrder['orderRejected']('error reason');
      expect(spy).toHaveBeenCalledWith(ORDER_INVALID_EVENT, {
        status: 'rejected',
        filled: false,
        reason: 'error reason',
      });
    });
  });

  describe('orderPartiallyFilled', () => {
    it('should emit ORDER_PARTIALLY_FILLED_EVENT with filled amount on orderPartiallyFilled', () => {
      const spy = vi.spyOn(testOrder, 'emit');
      testOrder['transactions'].set(defaultOrder.id!, {
        id: defaultOrder.id!,
        status: 'open',
        timestamp: defaultOrder.timestamp!,
        filled: 0,
      });
      testOrder['orderPartiallyFilled']('tx1', 10);
      expect(spy).toHaveBeenCalledWith(ORDER_PARTIALLY_FILLED_EVENT, 10);
    });

    it('should update the transaction filled amount in orderPartiallyFilled', () => {
      testOrder['transactions'].set(defaultOrder.id!, {
        id: defaultOrder.id!,
        status: 'open',
        timestamp: defaultOrder.timestamp!,
        filled: 0,
      });
      testOrder['orderPartiallyFilled']('tx1', 10);
      expect(testOrder['transactions'].get('tx1')?.filled).toBe(10);
    });
  });

  describe('orderFilled', () => {
    it('should set status to "filled" and emit ORDER_COMPLETED_EVENT with filled true on orderFilled', () => {
      const spy = vi.spyOn(testOrder, 'emit');
      testOrder['orderFilled']();
      expect(spy).toHaveBeenCalledWith(ORDER_COMPLETED_EVENT, { status: 'filled', filled: true });
    });
  });

  describe('orderErrored', () => {
    it('should set status to "error" and emit ORDER_ERRORED_EVENT event on orderErrored', () => {
      const error = new Error('test error');
      const spy = vi.spyOn(testOrder, 'emit');
      // Error events are treated as a special case in node.
      // If there is no listener for it, then the default action is to print a stack trace and exit the program.
      // So we need to declare an error listener
      testOrder.on('error', () => {});
      testOrder['orderErrored'](error);
      expect(spy).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, 'test error');
    });
  });

  describe('createLimitOrder', () => {
    it('should call exchange.createLimitOrder and then handleCreateOrderSuccess on success', async () => {
      const orderResponse = { id: 'order1', status: 'open', filled: 0, price: 100 };
      fakeExchange.createLimitOrder.mockResolvedValue(orderResponse);
      await testOrder['createLimitOrder']('BUY', 10, 99);
      expect(testOrder.handleCreateOrderSuccess).toHaveBeenCalledWith(orderResponse);
    });

    it('should call handleCreateOrderError when exchange.createLimitOrder rejects', async () => {
      const error = new Error('create failed');
      fakeExchange.createLimitOrder.mockRejectedValue(error);
      await testOrder['createLimitOrder']('BUY', 10, 100);
      expect(testOrder.handleCreateOrderError).toHaveBeenCalledWith(error);
    });
  });

  describe('createMarketOrder', () => {
    it('should call exchange.createMarketOrder and then handleCreateOrderSuccess on success', async () => {
      const orderResponse = { id: 'order1', status: 'closed', filled: 10, price: 100 };
      fakeExchange.createMarketOrder.mockResolvedValue(orderResponse);
      await testOrder['createMarketOrder']('BUY', 10);
      expect(testOrder.handleCreateOrderSuccess).toHaveBeenCalledWith(orderResponse);
    });

    it('should call handleCreateOrderError when exchange.createMarketOrder rejects', async () => {
      const error = new Error('create failed');
      fakeExchange.createMarketOrder.mockRejectedValue(error);
      await testOrder['createMarketOrder']('BUY', 10);
      expect(testOrder.handleCreateOrderError).toHaveBeenCalledWith(error);
    });
  });

  describe('cancelOrder', () => {
    it('should call exchange.cancelOrder and then handleCancelOrderSuccess on success', async () => {
      const orderResponse = { id: 'order1', filled: 0, remaining: 10 };
      fakeExchange.cancelOrder.mockResolvedValue(orderResponse);
      await testOrder['cancelOrder']('order1');
      expect(testOrder.handleCancelOrderSuccess).toHaveBeenCalledWith(orderResponse);
    });

    it('should call handleCancelOrderError when exchange.cancelOrder rejects', async () => {
      const error = new Error('cancel failed');
      fakeExchange.cancelOrder.mockRejectedValue(error);
      await testOrder['cancelOrder']('order1');
      expect(testOrder.handleCancelOrderError).toHaveBeenCalledWith(error);
    });
  });

  describe('fetchOrder', () => {
    it('should call exchange.fetchOrder and then handleFetchOrderSuccess on success', async () => {
      const orderResponse = { id: 'order1', status: 'open', filled: 0, price: 100 };
      fakeExchange.fetchOrder.mockResolvedValue(orderResponse);
      await testOrder['fetchOrder']('order1');
      expect(testOrder.handleFetchOrderSuccess).toHaveBeenCalledWith(orderResponse);
    });

    it('should call handleFetchOrderError when exchange.fetchOrder rejects', async () => {
      const error = new Error('fetch failed');
      fakeExchange.fetchOrder.mockRejectedValue(error);
      await testOrder['fetchOrder']('order1');
      expect(testOrder.handleFetchOrderError).toHaveBeenCalledWith(error);
    });
  });
});
