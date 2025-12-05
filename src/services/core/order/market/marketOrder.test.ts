import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { OrderSide, OrderState } from '@models/order.types';
import { InvalidOrder } from '@services/exchange/exchange.error';
import * as Logger from '@services/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketOrder } from './marketOrder';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ mode: 'backtest' }),
  },
}));

const fakeExchange = {
  createMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyTrades: vi.fn(),
};

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: () => fakeExchange,
  },
}));

describe('MarketOrder', () => {
  let order: MarketOrder;
  const orderId = 'ee21e130-48bc-405f-be0c-46e9bf17b52e';
  const side: OrderSide = 'BUY';
  const amount = 1;

  beforeEach(() => {
    order = new MarketOrder(orderId, side, amount);
  });

  describe('launch', () => {
    it('should call exchange.createMarketOrder with correct parameters', async () => {
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'open',
        timestamp: 1000,
        filled: 0,
        remaining: 1,
      });

      await order.launch();

      expect(fakeExchange.createMarketOrder).toHaveBeenCalledWith(side, amount);
    });

    it('should handle successful order creation (open)', async () => {
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'open',
        timestamp: 1000,
        filled: 0,
        remaining: 1,
      });

      const spyEmit = vi.spyOn(order, 'emit');

      await order.launch();

      expect(spyEmit).toHaveBeenCalledWith(ORDER_STATUS_CHANGED_EVENT, { status: 'open', reason: undefined });
    });
  });

  describe('handleCreateOrderError', () => {
    it('should emit ORDER_INVALID_EVENT if error is InvalidOrder', async () => {
      const error = new InvalidOrder('invalid order parameters');
      fakeExchange.createMarketOrder.mockRejectedValue(error);
      const spyEmit = vi.spyOn(order, 'emit');

      await order.launch();

      expect(spyEmit).toHaveBeenCalledWith(ORDER_INVALID_EVENT, {
        status: 'rejected',
        filled: false,
        reason: expect.stringContaining('invalid order parameters'),
      });
    });

    it('should emit ORDER_ERRORED_EVENT if error is generic Error', async () => {
      const error = new Error('Network error');
      fakeExchange.createMarketOrder.mockRejectedValue(error);
      const spyEmit = vi.spyOn(order, 'emit');

      await expect(order.launch()).rejects.toThrow('Network error');
      expect(spyEmit).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, 'Network error');
    });

    it('should rethrow if error is not an instance of Error', async () => {
      const error = 'some string error';
      fakeExchange.createMarketOrder.mockRejectedValue(error);

      await expect(order.launch()).rejects.toBe('some string error');
    });
  });

  describe('cancel', () => {
    it('should do nothing if order has no ID', async () => {
      await order.cancel();
      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('should do nothing if isOrderCompleted returns true', async () => {
      // Simulate completed order
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'closed',
        filled: 1,
        remaining: 0,
        timestamp: 1000,
      });
      await order.launch(); // Order becomes 'filled' (completed)

      await order.cancel();

      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('should call exchange.cancelOrder if order is active and has ID', async () => {
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'open',
        filled: 0,
        remaining: 1,
        timestamp: 1000,
      });
      await order.launch(); // Order is open

      fakeExchange.cancelOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'canceled',
        filled: 0,
        remaining: 1,
        timestamp: 2000,
      });

      await order.cancel();

      expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('ex-1');
    });
  });

  describe('handleCancelOrderError', () => {
    beforeEach(async () => {
      // Setup an open order to cancel
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'open',
        filled: 0,
        remaining: 1,
        timestamp: 1000,
      });
      await order.launch();
    });

    it('should emit ORDER_ERRORED_EVENT on cancel error', async () => {
      fakeExchange.cancelOrder.mockRejectedValue(new Error('Cancel failed'));
      const spyEmit = vi.spyOn(order, 'emit');

      await expect(order.cancel()).rejects.toThrow('Cancel failed');

      expect(spyEmit).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, 'Cancel failed');
    });

    it('should rethrow non-Error objects', async () => {
      fakeExchange.cancelOrder.mockRejectedValue('string error');

      await expect(order.cancel()).rejects.toBe('string error');
    });
  });

  describe('checkOrder', () => {
    it('should resolve immediately (no-op)', async () => {
      await expect(order.checkOrder()).resolves.toBeUndefined();
    });
  });

  describe('Handlers Coverage', () => {
    // These methods are protected/inherited but we want to ensure coverage of MarketOrder specific implementation
    // Using cast to any to access protected methods for direct testing of specific flows

    it('should handle fetch success via handleFetchOrderSuccess', () => {
      const spyApply = vi.spyOn(order as any, 'applyOrderUpdate');
      const orderState: OrderState = { id: 'ex-1', status: 'open', timestamp: 1000 };

      (order as any).handleFetchOrderSuccess(orderState);

      expect(spyApply).toHaveBeenCalledWith(orderState);
    });

    it('should handle fetch error via handleFetchOrderError', () => {
      const spyEmit = vi.spyOn(order, 'emit');

      expect(() => (order as any).handleFetchOrderError(new Error('Fetch failed'))).toThrow('Fetch failed');

      expect(spyEmit).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, 'Fetch failed');
    });

    it('should rethrow non-Error in handleFetchOrderError', () => {
      expect(() => (order as any).handleFetchOrderError('string error')).toThrow('string error');
    });

    it('should handle create error via handleCreateOrderSuccess', () => {
      // already covered in launch, but ensuring direct call works too
      const spyApply = vi.spyOn(order as any, 'applyOrderUpdate');
      const orderState: OrderState = { id: 'ex-1', status: 'open', timestamp: 1000 };

      (order as any).handleCreateOrderSuccess(orderState);

      expect(spyApply).toHaveBeenCalledWith(orderState);
    });

    it('should handle cancel success via handleCancelOrderSuccess', () => {
      const spyApply = vi.spyOn(order as any, 'applyOrderUpdate');
      const orderState: OrderState = { id: 'ex-1', status: 'canceled', timestamp: 1000 };

      (order as any).handleCancelOrderSuccess(orderState);

      expect(spyApply).toHaveBeenCalledWith(orderState);
    });
  });

  describe('applyOrderUpdate logic', () => {
    // We can test this by triggering an event that calls applyOrderUpdate, e.g. handleFetchOrderSuccess

    it('should return early if order has no ID', () => {
      const spyEmit = vi.spyOn(order, 'emit');
      (order as any).applyOrderUpdate({ status: 'open', timestamp: 1000 } as OrderState); // No ID
      expect(spyEmit).not.toHaveBeenCalled();
    });

    it('should emit ORDER_PARTIALLY_FILLED_EVENT if filled > 0', () => {
      const spyEmit = vi.spyOn(order, 'emit');
      (order as any).applyOrderUpdate({ id: 'ex-1', status: 'open', filled: 0.5, timestamp: 1000 } as OrderState);
      expect(spyEmit).toHaveBeenCalledWith(ORDER_PARTIALLY_FILLED_EVENT, 0.5);
    });

    it.each`
      status        | expectedEvent            | payload
      ${'closed'}   | ${ORDER_COMPLETED_EVENT} | ${{ status: 'filled', filled: true }}
      ${'canceled'} | ${ORDER_CANCELED_EVENT}  | ${{ status: 'canceled', filled: 0, remaining: 1, timestamp: 1000 }}
    `('should emit $expectedEvent when status is $status', ({ status, expectedEvent, payload }) => {
      const spyEmit = vi.spyOn(order, 'emit');
      const orderState = { id: 'ex-1', status, filled: 0, remaining: 1, timestamp: 1000 };

      (order as any).applyOrderUpdate(orderState);

      expect(spyEmit).toHaveBeenCalledWith(expectedEvent, expect.objectContaining(payload));
    });

    it('should emit ORDER_STATUS_CHANGED_EVENT only if status changed for open orders', () => {
      // First update sets it to open
      (order as any).applyOrderUpdate({ id: 'ex-1', status: 'open', timestamp: 1000 });
      const spyEmit = vi.spyOn(order, 'emit');
      spyEmit.mockClear();

      // Second update same status
      (order as any).applyOrderUpdate({ id: 'ex-1', status: 'open', timestamp: 1001 });
      expect(spyEmit).not.toHaveBeenCalledWith(ORDER_STATUS_CHANGED_EVENT, expect.anything());

      // Third update changes status (not possible for 'open' really unless re-opening, but technically possible flow)
      // Let's manually manipulate internal state to 'completed' and back to 'open' to see change?
      // Or better, initializing -> open (happens once). Open -> Open (no emit).
    });

    it('should log warning for unexpected status', () => {
      (order as any).applyOrderUpdate({ id: 'ex-1', status: 'unexpected_status', timestamp: 1000 });

      expect(Logger.warning).toHaveBeenCalledWith(
        'order',
        expect.stringContaining('order update returned unexpected status: unexpected_status'),
      );
    });

    it('should log warning for null status', () => {
      (order as any).applyOrderUpdate({ id: 'ex-1', status: undefined, timestamp: 1000 });

      expect(Logger.warning).toHaveBeenCalledWith(
        'order',
        expect.stringContaining('order update returned unexpected status: unknown'),
      );
    });
  });

  describe('createSummary', () => {
    it('should throw GekkoError if order is not completed', async () => {
      await expect(order.createSummary()).rejects.toThrow(GekkoError);
    });

    it('should return summary if order is completed', async () => {
      // Complete the order
      fakeExchange.createMarketOrder.mockResolvedValue({
        id: 'ex-1',
        status: 'closed',
        filled: 1,
        remaining: 0,
        timestamp: 1000,
      });
      fakeExchange.fetchMyTrades.mockResolvedValue([
        { id: 'ex-1', order: 'ex-1', amount: 1, price: 100, fee: { cost: 1, currency: 'USD' }, timestamp: 1000 },
      ]);

      await order.launch();

      const summary = await order.createSummary();

      expect(summary).toBeDefined();
      expect(summary.side).toBe(side);
    });
  });
});
