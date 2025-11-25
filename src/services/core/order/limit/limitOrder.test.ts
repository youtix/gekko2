import { ORDER_CANCELED_EVENT, ORDER_COMPLETED_EVENT, ORDER_INVALID_EVENT } from '@constants/event.const';
import { OrderState } from '@models/order.types';
import { InvalidOrder } from '@services/exchange/exchange.error';
import { toTimestamp } from '@utils/date/date.utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LimitOrder } from './limitOrder';

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
  createLimitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyTrades: vi.fn(),
  getIntervals: vi.fn(() => ({ orderSync: 1000 })),
  getInterval: vi.fn(() => 10),
};

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: () => fakeExchange,
  },
}));

describe('LimitOrder', () => {
  const defaultOrder: OrderState = {
    id: 'order-1',
    status: 'open',
    filled: 0,
    remaining: 1,
    price: 100,
    timestamp: toTimestamp('2025'),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(fakeExchange).forEach(value => {
      if (typeof value === 'function') value.mockReset();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a limit order with the provided price and amount', async () => {
    fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
    const order = new LimitOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', 'BUY', 1.5, 101);

    await order.launch();

    expect(fakeExchange.createLimitOrder).toHaveBeenCalledWith('BUY', 1.5, 101);
    expect([...order['transactions'].values()]).toEqual([
      { id: 'order-1', timestamp: defaultOrder.timestamp, filled: 0, status: 'open' },
    ]);
  });

  it('marks the order as filled when exchange reports closed status', async () => {
    const filledOrder: OrderState = { ...defaultOrder, status: 'closed', filled: 1.5 };
    fakeExchange.createLimitOrder.mockResolvedValue(filledOrder);
    fakeExchange.fetchMyTrades.mockResolvedValue([
      { id: 'order-1', amount: 1.5, price: 100, timestamp: filledOrder.timestamp, fee: { rate: 0.1 } },
    ]);
    const order = new LimitOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', 'SELL', 1.5, 99);

    const emitSpy = vi.spyOn(order as unknown as { emit: (event: string, payload?: unknown) => boolean }, 'emit');
    await order.launch();

    expect(emitSpy).toHaveBeenCalledWith(ORDER_COMPLETED_EVENT, { status: 'filled', filled: true });
    const summary = await order.createSummary();
    expect(summary.amount).toBe(1.5);
    expect(summary.side).toBe('SELL');
  });

  it('emits order rejected when exchange rejects the order', async () => {
    const error = new InvalidOrder('too small');
    fakeExchange.createLimitOrder.mockRejectedValue(error);

    const order = new LimitOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', 'BUY', 2, 105);
    const emitSpy = vi.spyOn(order as unknown as { emit: (event: string, payload?: unknown) => boolean }, 'emit');

    await expect(order.launch()).resolves.toBeUndefined();
    expect(emitSpy).toHaveBeenCalledWith(
      ORDER_INVALID_EVENT,
      expect.objectContaining({
        status: 'rejected',
        filled: false,
        reason: error.message,
      }),
    );
  });

  it('emits cancel event with filled amount when order is canceled after a partial fill', async () => {
    fakeExchange.createLimitOrder.mockResolvedValue(defaultOrder);
    const order = new LimitOrder('ee21e130-48bc-405f-be0c-46e9bf17b52e', 'BUY', 2, 100);
    await order.launch();

    order['handleFetchOrderSuccess']({ ...defaultOrder, filled: 1, remaining: 1, status: 'open' });
    const emitSpy = vi.spyOn(order as unknown as { emit: (event: string, payload?: unknown) => boolean }, 'emit');
    order['handleCancelOrderSuccess']({ ...defaultOrder, status: 'canceled', filled: 1, remaining: 1 });

    expect(emitSpy).toHaveBeenCalledWith(ORDER_CANCELED_EVENT, {
      status: 'canceled',
      filled: 1,
      remaining: 1,
      price: 100,
      timestamp: defaultOrder.timestamp,
    });
  });
});
