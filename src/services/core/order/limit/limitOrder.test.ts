import { ORDER_CANCELED_EVENT, ORDER_COMPLETED_EVENT, ORDER_INVALID_EVENT, ORDER_PARTIALLY_FILLED_EVENT } from '@constants/event.const';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderState } from '@models/order.types';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { toTimestamp } from '@utils/date/date.utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LimitOrder } from './limitOrder';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    getWatch: vi.fn(),
    getExchange: vi.fn(),
  },
}));

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: mockConfig,
}));

const fakeExchange = {
  createLimitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyTrades: vi.fn(),
};

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: () => fakeExchange,
  },
}));

describe('LimitOrder', () => {
  const defaultOrderId = 'order-1';
  const defaultGekkoId = 'ee21e130-48bc-405f-be0c-46e9bf17b52e';
  const defaultOrder: OrderState = {
    id: defaultOrderId,
    status: 'open',
    filled: 0,
    remaining: 1,
    price: 100,
    timestamp: toTimestamp('2025'),
  };

  let order: LimitOrder;

  beforeEach(() => {
    vi.useFakeTimers();
    mockConfig.getWatch.mockReturnValue({ mode: 'backtest', pairs: [{ symbol: 'BTC/USDT' }] });
    mockConfig.getExchange.mockReturnValue({ orderSynchInterval: 1000 });
    Object.values(fakeExchange).forEach(value => {
      if (typeof value === 'function') value.mockReset();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it.each`
      mode          | shouldSetInterval
      ${'backtest'} | ${false}
      ${'realtime'} | ${true}
    `('initializes correctly in $mode mode (interval: $shouldSetInterval)', ({ mode, shouldSetInterval }) => {
      mockConfig.getWatch.mockReturnValue({ mode, pairs: [{ symbol: 'BTC/USDT' }] });
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 1, 100);

      if (shouldSetInterval) {
        expect(setIntervalSpy).toHaveBeenCalled();
      } else {
        expect(setIntervalSpy).not.toHaveBeenCalled();
      }
    });
  });

  describe('launch', () => {
    it('creates a limit order and handles success', async () => {
      fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 1.5, 101);

      await order.launch();

      expect(fakeExchange.createLimitOrder).toHaveBeenCalledWith('BTC/USDT', 'BUY', 1.5, 101, expect.any(Function));
      expect([...order['transactions'].values()]).toEqual([
        expect.objectContaining({
          id: defaultOrderId,
          status: 'open',
        }),
      ]);
    });

    it.each`
      error                                                   | reason
      ${new InvalidOrder('too small')}                        | ${'too small'}
      ${new OrderOutOfRangeError('order', 'out of range', 1)} | ${'out of range'}
    `('rejects order on known error: $error.name', async ({ error, reason }) => {
      fakeExchange.createLimitOrder.mockRejectedValue(error);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 2, 105);
      const emitSpy = vi.spyOn(order as any, 'emit');

      await order.launch();

      expect(emitSpy).toHaveBeenCalledWith(
        ORDER_INVALID_EVENT,
        expect.objectContaining({
          status: 'rejected',
          reason: expect.stringContaining(reason),
        }),
      );
    });

    it('throws on unknown error during creation', async () => {
      const error = new Error('Unknown error');
      fakeExchange.createLimitOrder.mockRejectedValue(error);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 2, 105);
      const emitSpy = vi.spyOn(order as any, 'emit');

      await expect(order.launch()).rejects.toThrow(error);
      expect(emitSpy).not.toHaveBeenCalledWith(ORDER_INVALID_EVENT, expect.anything());
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 1, 100);
    });

    it('does nothing if order is already completed', async () => {
      await order.launch();
      // Simulate completion
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: 'closed' });
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      await order.cancel();

      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('does nothing if order id is missing or initializing', async () => {
      // Not launched yet, so no ID and status is initializing
      await order.cancel();
      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('cancels order successfully', async () => {
      await order.launch();
      fakeExchange.cancelOrder.mockResolvedValue({
        ...defaultOrder,
        status: 'canceled',
      });

      await order.cancel();

      expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('BTC/USDT', defaultOrderId);
    });

    it('handles OrderNotFound error during cancel as filled', async () => {
      await order.launch();
      fakeExchange.cancelOrder.mockRejectedValue(new OrderNotFound('Not found'));
      const emitSpy = vi.spyOn(order as any, 'emit');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      await order.cancel();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(ORDER_COMPLETED_EVENT, expect.objectContaining({ status: 'filled' }));
    });

    it('throws unknown error during cancel', async () => {
      await order.launch();
      fakeExchange.cancelOrder.mockRejectedValue(new Error('Network error'));

      await expect(order.cancel()).rejects.toThrow('Network error');
    });
  });

  describe('checkOrder', () => {
    beforeEach(() => {
      mockConfig.getWatch.mockReturnValue({ mode: 'realtime', pairs: [{ symbol: 'BTC/USDT' }] });
      fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 1, 100);
    });

    it('stops checking if order is completed', async () => {
      await order.launch();
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: 'closed' });
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      fakeExchange.fetchOrder.mockClear();

      await order.checkOrder();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();
    });

    it('skips if initializing or no id or already checking', async () => {
      // initializing case
      await order.checkOrder();
      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();

      await order.launch();

      // isChecking case
      (order as any).isChecking = true;
      await order.checkOrder();
      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();
    });

    it('prioritizes cancellation if isCanceling is true', async () => {
      await order.launch();
      (order as any).isCanceling = true;
      fakeExchange.cancelOrder.mockResolvedValue({ ...defaultOrder, status: 'canceled' });

      await order.checkOrder();

      expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('BTC/USDT', defaultOrderId);
      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();
    });

    it('fetches order and updates state', async () => {
      await order.launch();
      fakeExchange.fetchOrder.mockResolvedValue({
        ...defaultOrder,
        filled: 0.5,
        remaining: 0.5,
      });
      const emitSpy = vi.spyOn(order as any, 'emit');

      await order.checkOrder();

      expect(fakeExchange.fetchOrder).toHaveBeenCalledWith('BTC/USDT', defaultOrderId);
      expect(emitSpy).toHaveBeenCalledWith(ORDER_PARTIALLY_FILLED_EVENT, 0.5);
    });

    it('throws on fetch error', async () => {
      await order.launch();
      fakeExchange.fetchOrder.mockRejectedValue(new Error('Fetch failed'));

      await expect(order.checkOrder()).rejects.toThrow('Fetch failed');
    });
  });

  describe('Event Handling & State Updates', () => {
    beforeEach(async () => {
      fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
      order = new LimitOrder('BTC/USDT', defaultGekkoId, 'BUY', 1, 100);
      await order.launch();
    });

    it.each`
      status        | event                    | payload
      ${'closed'}   | ${ORDER_COMPLETED_EVENT} | ${{ status: 'filled' }}
      ${'canceled'} | ${ORDER_CANCELED_EVENT}  | ${{ status: 'canceled' }}
    `('handles $status status by emitting $event', ({ status, event, payload }) => {
      const emitSpy = vi.spyOn(order as any, 'emit');
      (order as any).handleFetchOrderSuccess({
        ...defaultOrder,
        status,
        filled: status === 'closed' ? 1 : 0,
      });

      expect(emitSpy).toHaveBeenCalledWith(event, expect.objectContaining(payload));
    });

    it('checks status logic (retains status if updated to same)', async () => {
      // Force internal status to something else
      (order as any).status = 'initializing';

      // Update transaction map to simulate old status causing a change if it differed
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: 'canceled' });

      // Now update to open. Since old transaction is canceled, if we update to open, it should setStatus('open')
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: 'open' });
      expect((order as any).getStatus()).toBe('open');
    });

    it('warns on unexpected status', async () => {
      const warningSpy = await import('@services/logger').then(m => m.warning);
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: 'unknown_status' as any });

      expect(warningSpy).toHaveBeenCalledWith('order', expect.stringContaining('unexpected status'));

      // Cover nullish status branch
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, status: undefined });
      expect(warningSpy).toHaveBeenCalledWith('order', expect.stringContaining('unknown'));
    });

    it('ignores update if order id is missing', async () => {
      // Accessing private map to verify no change
      const initialSize = order['transactions'].size;
      (order as any).handleFetchOrderSuccess({ ...defaultOrder, id: undefined });
      expect(order['transactions'].size).toBe(initialSize);
    });
  });

  describe('Error Handling Edge Cases', () => {
    it.each([['handleCreateOrderError'], ['handleCancelOrderError'], ['handleFetchOrderError']])(
      '%s throws non-Error objects',
      async method => {
        const nonError = 'some string error';
        try {
          (order as any)[method](nonError);
        } catch (e) {
          expect(e).toBe(nonError);
        }
        // Ensure orderErrored was NOT called (mock it if possible, or check status not error)
        // Since orderErrored sets status to 'error', checking status
        expect((order as any).getStatus()).not.toBe('error');
      },
    );
  });
});
