import { OrderState } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_COMPLETED_EVENT, ORDER_ERRORED_EVENT } from '../order.const';
import { MarketOrder } from './marketOrder';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

describe('MarketOrder', () => {
  const fakeExchange = {
    createMarketOrder: vi.fn(),
    fetchMyTrades: vi.fn(),
    createLimitOrder: vi.fn(),
    cancelLimitOrder: vi.fn(),
    fetchOrder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits completion when market order is filled immediately', async () => {
    const orderResponse: OrderState = { id: 'order-1', status: 'closed', filled: 1, timestamp: 1_700_000_000_000 };
    fakeExchange.createMarketOrder.mockResolvedValue(orderResponse);

    const order = new MarketOrder('BUY', 1, fakeExchange as unknown as Exchange);
    const emitSpy = vi.spyOn(order as unknown as { emit: (event: string, payload?: unknown) => boolean }, 'emit');

    await order.creation;

    expect(fakeExchange.createMarketOrder).toHaveBeenCalledWith('BUY', 1);
    expect(order['transactions']).toEqual([{ id: 'order-1', timestamp: orderResponse.timestamp, filled: 1 }]);
    expect(emitSpy).toHaveBeenCalledWith(ORDER_COMPLETED_EVENT, { status: 'filled', filled: true });
  });

  it('emits error event when market order creation fails', async () => {
    const error = new Error('exchange down');
    fakeExchange.createMarketOrder.mockRejectedValue(error);

    const order = new MarketOrder('SELL', 2, fakeExchange as unknown as Exchange);
    const emitSpy = vi.spyOn(order as unknown as { emit: (event: string, payload?: unknown) => boolean }, 'emit');

    await expect(order.creation).rejects.toThrow('exchange down');
    expect(emitSpy).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, 'exchange down');
  });

  it('builds a trade summary once the order is completed', async () => {
    const timestamp = 1_700_000_000_000;
    const orderResponse: OrderState = { id: 'order-2', status: 'closed', filled: 2, timestamp };
    fakeExchange.createMarketOrder.mockResolvedValue(orderResponse);
    fakeExchange.fetchMyTrades.mockResolvedValue([
      { id: 'order-2', amount: 1, timestamp, price: 10, fee: { rate: 0.1 } },
      { id: 'order-2', amount: 1, timestamp: timestamp + 1, price: 12, fee: { rate: 0.2 } },
      { id: 'other-order', amount: 5, timestamp: timestamp + 2, price: 20, fee: { rate: 0.3 } },
    ]);

    const order = new MarketOrder('BUY', 2, fakeExchange as unknown as Exchange);
    await order.creation;

    const summary = await order.createSummary();

    expect(fakeExchange.fetchMyTrades).toHaveBeenCalled();
    expect(summary.amount).toBe(2);
    expect(summary.price).toBe(11);
    expect(summary.side).toBe('BUY');
    expect(summary.date).toBe(timestamp + 1);
    expect(summary.feePercent).toBeCloseTo(0.15);
  });
});
