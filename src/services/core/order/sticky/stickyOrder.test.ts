import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderState } from '@models/order.types';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import * as logger from '@services/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StickyOrder } from './stickyOrder';

const fakeExchange = {
  fetchTicker: vi.fn(),
  getMarketData: vi.fn(),
  createLimitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
};

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ mode: 'backtest', pairs: [{ symbol: 'BTC/USDT' }] }),
    getExchange: () => ({ orderSynchInterval: 1000 }),
  },
}));

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: () => fakeExchange,
  },
}));

describe('StickyOrder', () => {
  const defaultOrder: OrderState = { id: 'order-1', status: 'open', filled: 0, remaining: 5, timestamp: Date.now() };
  const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    Object.values(fakeExchange).forEach(value => {
      if (typeof value === 'function') value.mockReset();
    });
    fakeExchange.fetchTicker.mockResolvedValue({ bid: 100, ask: 105 });
    fakeExchange.getMarketData.mockReturnValue({ price: { min: 2 } });
    fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
    fakeExchange.cancelOrder.mockResolvedValue({ ...defaultOrder, status: 'canceled' });
    fakeExchange.fetchOrder.mockResolvedValue(defaultOrder);
  });

  const createOrder = async (side: 'BUY' | 'SELL', amount = 5) => {
    const order = new StickyOrder('BTC/USDT', 'ee21e130-48bc-405f-be0c-46e9bf17b52e', side, amount);
    await order.launch();
    await flushAsync();
    return order;
  };

  describe('launch', () => {
    it.each`
      side      | amount | tickerBid | tickerAsk | marketMin | expectedPrice
      ${'BUY'}  | ${10}  | ${100}    | ${105}    | ${2}      | ${102}
      ${'SELL'} | ${10}  | ${100}    | ${105}    | ${2}      | ${103}
    `(
      'places an initial limit order for $side with price $expectedPrice',
      async ({ side, amount, tickerBid, tickerAsk, marketMin, expectedPrice }) => {
        fakeExchange.fetchTicker.mockResolvedValue({ bid: tickerBid, ask: tickerAsk });
        fakeExchange.getMarketData.mockReturnValue({ price: { min: marketMin } });

        await createOrder(side, amount);

        expect(fakeExchange.createLimitOrder).toHaveBeenCalledWith('BTC/USDT', side, amount, expectedPrice, expect.any(Function));
      },
    );

    it('creates additional orders using the remaining amount after fills', async () => {
      const order = await createOrder('SELL', 6); // Initial launch
      // Simulate partial fill on first order
      order['transactions'].set('order-1', { id: 'order-1', status: 'open', filled: 4, timestamp: Date.now() });
      fakeExchange.fetchTicker.mockResolvedValue({ bid: 50, ask: 60 });
      fakeExchange.createLimitOrder.mockResolvedValue({ ...defaultOrder, id: 'order-2' });

      await order.launch(); // Re-launch (e.g. after move)

      expect(fakeExchange.createLimitOrder).toHaveBeenLastCalledWith('BTC/USDT', 'SELL', 2, 58, expect.any(Function));
    });
  });

  describe('cancel', () => {
    it('does nothing when order is already completed', async () => {
      const order = await createOrder('BUY');
      order['setStatus']('filled');
      await order.cancel();
      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('forwards cancelation when order id is set and status is open', async () => {
      const order = await createOrder('BUY');
      order['setStatus']('open');
      order['id'] = 'order-1';
      await order.cancel();
      expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('BTC/USDT', 'order-1');
    });

    it('does not cancel if order id is missing', async () => {
      const order = await createOrder('BUY');
      order['setStatus']('open');
      order['id'] = undefined;
      await order.cancel();
      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('does not cancel if already checking', async () => {
      const order = await createOrder('BUY');
      order['setStatus']('open');
      order['id'] = 'order-1';
      order['isChecking'] = true;
      await order.cancel();
      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('clears interval if status is not error after cancel', async () => {
      const order = await createOrder('BUY');
      order['setStatus']('open');
      order['id'] = 'order-1';
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      await order.cancel();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('checkOrder', () => {
    it('fetches the latest order status when still active', async () => {
      const order = await createOrder('SELL');
      order['setStatus']('open');
      order['id'] = 'order-1';

      await order.checkOrder();

      expect(fakeExchange.fetchOrder).toHaveBeenCalledWith('BTC/USDT', 'order-1');
    });

    it.each`
      condition             | setup
      ${'completed'}        | ${(o: StickyOrder) => o['setStatus']('filled')}
      ${'no id'}            | ${(o: StickyOrder) => (o['id'] = undefined)}
      ${'initializing'}     | ${(o: StickyOrder) => o['setStatus']('initializing')}
      ${'already checking'} | ${(o: StickyOrder) => (o['isChecking'] = true)}
    `('skips fetching when $condition', async ({ setup }) => {
      const order = await createOrder('SELL');
      order['id'] = 'order-1'; // Default valid id
      setup(order);

      await order.checkOrder();

      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();
    });

    it('executes cancel if isCanceling is true', async () => {
      const order = await createOrder('SELL');
      order['id'] = 'order-1';
      order['isCanceling'] = true;
      const cancelSpy = vi.spyOn(order, 'cancel');

      await order.checkOrder();

      expect(cancelSpy).toHaveBeenCalled();
      expect(fakeExchange.fetchOrder).not.toHaveBeenCalled();
    });

    it('handles errors during fetch', async () => {
      const order = await createOrder('SELL');
      order['id'] = 'order-1';
      fakeExchange.fetchOrder.mockRejectedValue(new Error('Fetch failed'));
      const erroredSpy = vi.spyOn(order as any, 'orderErrored');

      await order.checkOrder(); // Should catch inside fetchOrder -> handleFetchOrderError

      expect(erroredSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Fetch failed' }));
    });
  });

  describe('move', () => {
    it('executes cancel and launch sequence', async () => {
      const order = await createOrder('BUY', 10);
      order['id'] = 'order-1';
      const launchSpy = vi.spyOn(order, 'launch');

      await order['move']();

      expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('BTC/USDT', 'order-1');
      expect(launchSpy).toHaveBeenCalled();
    });

    it('does not move if canceling', async () => {
      const order = await createOrder('BUY', 10);
      order['isCanceling'] = true;
      const launchSpy = vi.spyOn(order, 'launch');

      await order['move']();

      expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it('stops move if cancel results in error', async () => {
      const order = await createOrder('BUY', 10);
      order['id'] = 'order-1';
      fakeExchange.cancelOrder.mockRejectedValue(new Error('Cancel failed'));
      // We need to mock handleCancelOrderError to set status to error,
      // because super.cancelOrder calls it.
      // But here we can rely on standard behavior if we spy on it?
      // Wait, super.cancelOrder catches error and calls handleCancelOrderError.
      // handleCancelOrderError calls orderErrored which sets status to error.

      await order['move']();

      // The order should be in error state effectively
      // The implementation checks: if (this.getStatus() !== 'error' ... ) await this.launch();
      // Since 'cancel' failed, it called handleCancelOrderError -> orderErrored -> setStatus('error')
      expect(order['getStatus']()).toBe('error');
    });
  });

  describe('handleCreateOrderSuccess', () => {
    it.each`
      status        | outcome
      ${'closed'}   | ${'orderFilled'}
      ${'canceled'} | ${'orderCanceled'}
    `('calls $outcome when status is $status', async ({ status, outcome }) => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, outcome);

      await order['handleCreateOrderSuccess']({ ...defaultOrder, status, filled: 5, remaining: 0 });

      expect(spy).toHaveBeenCalled();
    });

    it('propagates status updates for open orders', async () => {
      const order = await createOrder('BUY');
      const setStatusSpy = vi.spyOn(order as any, 'setStatus');

      await order['handleCreateOrderSuccess']({ ...defaultOrder, status: 'open' });

      expect(setStatusSpy).toHaveBeenCalledWith('open');
    });

    it('logs warning for unknown status', async () => {
      const order = await createOrder('BUY');

      await order['handleCreateOrderSuccess']({ ...defaultOrder, status: 'unknown' as any });

      expect(logger.warning).toHaveBeenCalled();
    });

    it('updates transactions and partial fills', async () => {
      const order = await createOrder('BUY');
      const partialSpy = vi.spyOn(order as any, 'orderPartiallyFilled');

      await order['handleCreateOrderSuccess']({ ...defaultOrder, status: 'open', filled: 2 });

      expect(order['transactions'].get(defaultOrder.id)?.filled).toBe(2);
      expect(partialSpy).toHaveBeenCalledWith(defaultOrder.id, 2);
    });
  });

  describe('handleCreateOrderError', () => {
    it.each`
      errorType            | errorInstance                                          | partiallyFilled | outcome
      ${'OrderOutOfRange'} | ${new OrderOutOfRangeError('order', 'Range error', 1)} | ${true}         | ${'orderFilled'}
      ${'OrderOutOfRange'} | ${new OrderOutOfRangeError('order', 'Range error', 1)} | ${false}        | ${'orderRejected'}
      ${'InvalidOrder'}    | ${new InvalidOrder('Invalid')}                         | ${false}        | ${'orderRejected'}
      ${'Generic Error'}   | ${new Error('Generic failure')}                        | ${false}        | ${'orderErrored'}
    `(
      'calls $outcome when error is $errorType and partiallyFilled is $partiallyFilled',
      async ({ errorInstance, partiallyFilled, outcome }) => {
        const order = await createOrder('BUY', 10);
        if (partiallyFilled) {
          order['transactions'].set('prev-order', { id: 'prev', filled: 5, timestamp: Date.now(), status: 'closed' });
        }
        const spy = vi.spyOn(order as any, outcome);

        try {
          await order['handleCreateOrderError'](errorInstance);
        } catch (e) {
          // handleCreateOrderError re-throws Error if it's not one of specific types or logic flow
          if (outcome !== 'orderErrored') throw e;
        }

        expect(spy).toHaveBeenCalled();
      },
    );
  });

  describe('handleCancelOrderSuccess', () => {
    it('calls orderFilled if remaining is 0', async () => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, 'orderFilled');
      await order['handleCancelOrderSuccess']({ ...defaultOrder, status: 'canceled', remaining: 0 });
      expect(spy).toHaveBeenCalled();
    });

    it('calls orderFilled if total filled equals amount', async () => {
      const order = await createOrder('BUY', 10);
      order['transactions'].set('prev', { id: 'prev', filled: 5, timestamp: Date.now(), status: 'closed' });
      const spy = vi.spyOn(order as any, 'orderFilled');
      await order['handleCancelOrderSuccess']({ ...defaultOrder, status: 'canceled', filled: 5 }); // 5+5 = 10
      expect(spy).toHaveBeenCalled();
    });

    it('calls orderCanceled if not moving and not filled', async () => {
      const order = await createOrder('BUY', 10);
      const spy = vi.spyOn(order as any, 'orderCanceled');
      await order['handleCancelOrderSuccess']({ ...defaultOrder, status: 'canceled', filled: 2, remaining: 8 });
      expect(spy).toHaveBeenCalled();
    });

    it('does NOT call orderCanceled if moving', async () => {
      const order = await createOrder('BUY', 10);
      order['isMoving'] = true;
      const spy = vi.spyOn(order as any, 'orderCanceled');
      await order['handleCancelOrderSuccess']({ ...defaultOrder, status: 'canceled', filled: 2 });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('handleCancelOrderError', () => {
    it('calls orderFilled on OrderNotFound', async () => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, 'orderFilled');
      await order['handleCancelOrderError'](new OrderNotFound('Not found'));
      expect(spy).toHaveBeenCalled();
    });

    it('calls orderErrored on other errors', async () => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, 'orderErrored');
      await order['handleCancelOrderError'](new Error('Fail'));
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleFetchOrderSuccess', () => {
    it('calls orderFilled when status is closed', async () => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, 'orderFilled');
      await order['handleFetchOrderSuccess']({ ...defaultOrder, status: 'closed' });
      expect(spy).toHaveBeenCalled();
    });

    it('calls orderCanceled when status is canceled', async () => {
      const order = await createOrder('BUY');
      const spy = vi.spyOn(order as any, 'orderCanceled');
      await order['handleFetchOrderSuccess']({ ...defaultOrder, status: 'canceled' });
      expect(spy).toHaveBeenCalled();
    });

    it('triggers move when book price changes significantly for open order', async () => {
      const order = await createOrder('BUY');
      const moveSpy = vi.spyOn(order as any, 'move').mockResolvedValue(undefined);
      order['id'] = 'order-1';
      // Original price was around 102.
      // New ticker: bid 200 -> price 202.
      fakeExchange.fetchTicker.mockResolvedValue({ bid: 200, ask: 210 });

      await order['handleFetchOrderSuccess']({
        id: 'order-1',
        status: 'open',
        filled: 0,
        price: 102,
        remaining: 5,
        timestamp: Date.now(),
      });

      expect(moveSpy).toHaveBeenCalled();
    });

    it('does not trigger move when price is stable', async () => {
      const order = await createOrder('BUY');
      const moveSpy = vi.spyOn(order as any, 'move');
      order['id'] = 'order-1';
      // Ticker matches initial setup
      fakeExchange.fetchTicker.mockResolvedValue({ bid: 100, ask: 105 });

      await order['handleFetchOrderSuccess']({
        id: 'order-1',
        status: 'open',
        filled: 0,
        price: 102, // 100 + 2 = 102
        remaining: 5,
        timestamp: Date.now(),
      });

      expect(moveSpy).not.toHaveBeenCalled();
    });

    it('handles errors during price processing', async () => {
      const order = await createOrder('BUY');
      const errorSpy = vi.spyOn(order as any, 'orderErrored');
      fakeExchange.fetchTicker.mockRejectedValue(new Error('Price fail'));

      await expect(order['handleFetchOrderSuccess']({ ...defaultOrder, status: 'open' })).rejects.toThrow('Price fail');

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
