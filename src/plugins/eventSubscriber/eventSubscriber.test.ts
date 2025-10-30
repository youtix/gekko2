import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/advice.types';
import { OrderAborted, OrderCanceled, OrderCompleted, OrderErrored, OrderInitiated } from '../../models/order.types';
import { toTimestamp } from '../../utils/date/date.utils';
import { EventSubscriber } from './eventSubscriber';
import { eventSubscriberSchema } from './eventSubscriber.schema';
import { EVENT_NAMES } from './eventSubscriber.types';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'realtime', warmup: {} })),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

const fakeBot = { sendMessage: vi.fn(), listen: vi.fn(), close: vi.fn() };

describe('EventSubscriber', () => {
  let plugin: EventSubscriber;

  beforeEach(() => {
    plugin = new EventSubscriber({ name: 'EventSubscriber', botUsername: 'bot_name', token: 't' });
    plugin['bot'] = fakeBot as any;
    plugin['asset'] = 'BTC';
    plugin['currency'] = 'USD';
  });

  it.each`
    trigger                              | method
    ${() => plugin['processInit']()}     | ${'listen'}
    ${() => plugin['processFinalize']()} | ${'close'}
  `('invokes bot.$method', ({ trigger, method }) => {
    trigger();
    expect(fakeBot[method as 'listen' | 'close']).toHaveBeenCalled();
  });

  it.each`
    close
    ${42}
    ${0}
  `('updates price on processOneMinuteCandle', ({ close }) => {
    plugin['processOneMinuteCandle']({ close } as any);
    expect(plugin['price']).toBe(close);
  });

  describe('event notifications', () => {
    const onStrategyInfo = (p: EventSubscriber) =>
      p.onStrategyInfo({ timestamp: 1, level: 'debug', message: 'M', tag: 'strategy' });
    const onStrategyCreateOrder = (p: EventSubscriber) =>
      p.onStrategyCreateOrder({
        order: { type: 'STICKY', side: 'BUY', quantity: 1 },
        date: toTimestamp('2022-01-01T00:00:00Z'),
        id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
      } as Advice);
    const onOrderInitiated = (p: EventSubscriber) =>
      p.onOrderInitiated({
        side: 'BUY',
        balance: 1,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        portfolio: { asset: 0, currency: 0 },
        orderType: 'STICKY',
        requestedAmount: 1,
      } as OrderInitiated);
    const onOrderCanceled = (p: EventSubscriber) =>
      p.onOrderCanceled({
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        date: toTimestamp('2022-01-01T00:00:00Z'),
        orderType: 'STICKY',
      } as OrderCanceled);
    const onOrderAborted = (p: EventSubscriber) =>
      p.onOrderAborted({
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        side: 'BUY',
        balance: 0,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        portfolio: { asset: 0, currency: 0 },
        reason: 'r',
        orderType: 'STICKY',
        requestedAmount: 1,
      } as OrderAborted);
    const onOrderErrored = (p: EventSubscriber) =>
      p.onOrderErrored({
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        date: toTimestamp('2022-01-01T00:00:00Z'),
        reason: 'r',
        orderType: 'STICKY',
      } as OrderErrored);
    const onOrderCompleted = (p: EventSubscriber) =>
      p.onOrderCompleted({
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        side: 'BUY',
        amount: 1,
        balance: 1,
        cost: 1,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        effectivePrice: 1,
        portfolio: { asset: 0, currency: 0 },
        orderType: 'STICKY',
        requestedAmount: 1,
        price: 100,
      } as OrderCompleted);
    it.each`
      name                 | handler
      ${'strategy_info'}   | ${onStrategyInfo}
      ${'strategy_advice'} | ${onStrategyCreateOrder}
      ${'trade_initiated'} | ${onOrderInitiated}
      ${'trade_canceled'}  | ${onOrderCanceled}
      ${'trade_aborted'}   | ${onOrderAborted}
      ${'trade_errored'}   | ${onOrderErrored}
      ${'trade_completed'} | ${onOrderCompleted}
    `('sends message only when subscribed for $name', ({ name, handler }) => {
      fakeBot.sendMessage.mockReset();
      handler(plugin);
      plugin['handleCommand'](`/subscribe_to_${name}`);
      handler(plugin);
      expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('formats strategy advice message with order metadata', () => {
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/subscribe_to_strategy_advice');
      plugin.onStrategyCreateOrder({
        id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        date: toTimestamp('2022-01-01T00:00:00Z'),
        order: { type: 'MARKET', side: 'SELL', quantity: 3 },
      } as Advice);
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('MARKET SELL advice'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested quantity: 3'));
    });

    it('reports trade initiation details including order type and requested amount', () => {
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/subscribe_to_trade_initiated');
      plugin.onOrderInitiated({
        orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
        side: 'BUY',
        balance: 10,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        portfolio: { asset: 1, currency: 2 },
        orderType: 'MARKET',
        requestedAmount: 5,
      } as OrderInitiated);
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('MARKET order created (ee21e130-48bc-405f-be0c-46e9bf17b52e)'),
      );
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested amount: 5'));
    });
  });

  describe('commands', () => {
    it.each`
      preSubscribed | expected
      ${false}      | ${'Subscribed to trade_initiated'}
      ${true}       | ${'Unsubscribed from trade_initiated'}
    `('toggles subscription', ({ preSubscribed, expected }) => {
      if (preSubscribed) plugin['handleCommand']('/subscribe_to_trade_initiated');
      const res = plugin['handleCommand']('/subscribe_to_trade_initiated');
      expect(res).toBe(expected);
    });

    it.each`
      setup                                                             | expected
      ${() => undefined}                                                | ${'No subscriptions'}
      ${() => plugin['handleCommand']('/subscribe_to_trade_initiated')} | ${'trade_initiated'}
    `('lists subscriptions', ({ setup, expected }) => {
      setup();
      const res = plugin['handleCommand']('/subscriptions');
      expect(res).toContain(expected);
    });

    it.each`
      command                | size
      ${'/subscribe_to_all'} | ${EVENT_NAMES.length}
    `('subscribes to all', ({ command, size }) => {
      plugin['handleCommand'](command);
      expect(plugin['subscriptions'].size).toBe(size);
    });

    it.each`
      setup                                                 | command                    | size
      ${() => plugin['handleCommand']('/subscribe_to_all')} | ${'/unsubscribe_from_all'} | ${0}
    `('unsubscribes from all', ({ setup, command, size }) => {
      setup();
      plugin['handleCommand'](command);
      expect(plugin['subscriptions'].size).toBe(size);
    });

    it('returns help', () => {
      const res = plugin['handleCommand']('/help');
      expect(res).toBe(`Available commands:
/subscribe_to_strategy_info
/subscribe_to_strategy_advice
/subscribe_to_trade_initiated
/subscribe_to_trade_canceled
/subscribe_to_trade_aborted
/subscribe_to_trade_errored
/subscribe_to_trade_completed
/subscribe_to_all
/unsubscribe_from_all
/subscriptions
/help`);
    });
  });

  it('getStaticConfiguration returns meta', () => {
    const meta = EventSubscriber.getStaticConfiguration();
    expect(meta).toMatchObject({ schema: eventSubscriberSchema, name: 'EventSubscriber' });
  });
});
