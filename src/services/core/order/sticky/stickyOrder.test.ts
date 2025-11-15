import { OrderState } from '@models/order.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StickyOrder } from './stickyOrder';

const fakeExchange = {
  fetchTicker: vi.fn(),
  getMarketLimits: vi.fn(),
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
    fakeExchange.getMarketLimits.mockReturnValue({ price: { min: 2 } });
    fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
    fakeExchange.cancelOrder.mockResolvedValue({ ...defaultOrder, status: 'canceled' });
    fakeExchange.fetchOrder.mockResolvedValue(defaultOrder);
  });

  const createOrder = async (side: 'BUY' | 'SELL', amount = 5) => {
    const order = new StickyOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', side, amount);
    await flushAsync();
    return order;
  };

  it('places an initial limit order using ticker data and market limits', async () => {
    await createOrder('BUY', 10);
    expect(fakeExchange.createLimitOrder).toHaveBeenCalledWith('BUY', 10, 102);
  });

  it('creates additional orders using the remaining amount after fills', async () => {
    const order = await createOrder('SELL', 6);
    order['transactions'].set('order-1', { id: 'order-1', status: 'open', filled: 4, timestamp: Date.now() });
    fakeExchange.fetchTicker.mockResolvedValue({ bid: 50, ask: 60 });
    fakeExchange.createLimitOrder.mockResolvedValue({ ...defaultOrder, id: 'order-2' });

    await order['createStickyOrder']();

    expect(fakeExchange.createLimitOrder).toHaveBeenLastCalledWith('SELL', 2, 58);
  });

  it('cancel does nothing when order is already completed', async () => {
    const order = await createOrder('BUY');
    order['setStatus']('filled');
    await order.cancel();
    expect(fakeExchange.cancelOrder).not.toHaveBeenCalled();
  });

  it('cancel forwards cancelation when order id is set and status is open', async () => {
    const order = await createOrder('BUY');
    order['setStatus']('open');
    order['id'] = 'order-1';
    await order.cancel();
    expect(fakeExchange.cancelOrder).toHaveBeenCalledWith('order-1');
  });

  it('handleCreateOrderSuccess propagates status updates', async () => {
    const order = await createOrder('BUY');
    const filledSpy = vi.spyOn(order as any, 'orderFilled');
    order['handleCreateOrderSuccess']({ ...defaultOrder, status: 'closed', filled: 5 });
    expect(filledSpy).toHaveBeenCalled();
  });

  it('handleFetchOrderSuccess triggers move when book price changes', async () => {
    const order = await createOrder('BUY');
    const moveSpy = vi.spyOn(order as any, 'move').mockResolvedValue(undefined);
    order['id'] = 'order-1';
    fakeExchange.fetchTicker.mockResolvedValue({ bid: 200, ask: 210 });

    await order['handleFetchOrderSuccess']({
      id: 'order-1',
      status: 'open',
      filled: 0,
      price: 150,
      remaining: 5,
      timestamp: Date.now(),
    });

    expect(moveSpy).toHaveBeenCalled();
  });

  it('handleCancelOrderSuccess marks the order as filled when nothing remains', async () => {
    const order = await createOrder('BUY', 2);
    const filledSpy = vi.spyOn(order as any, 'orderFilled');

    await order['handleCancelOrderSuccess']({
      id: 'order-1',
      status: 'canceled',
      filled: 2,
      remaining: 0,
      timestamp: Date.now(),
    });

    expect(filledSpy).toHaveBeenCalled();
  });

  it('checkOrder fetches the latest order status when still active', async () => {
    const order = await createOrder('SELL');
    order['setStatus']('open');
    order['id'] = 'order-1';

    await order.checkOrder();

    expect(fakeExchange.fetchOrder).toHaveBeenCalledWith('order-1');
  });
});
