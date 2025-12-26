import { AdviceOrder } from '@models/advice.types';
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { EventSubscriber } from './eventSubscriber';
import { eventSubscriberSchema } from './eventSubscriber.schema';
import { EVENT_NAMES } from './eventSubscriber.types';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({ mode: 'realtime', warmup: {}, asset: 'BTC', currency: 'USD' })),
      getStrategy: vi.fn(() => ({})),
      showLogo: vi.fn(),
      getPlugins: vi.fn(),
      getStorage: vi.fn(),
      getExchange: vi.fn(),
    };
  });
  return { config: new Configuration() };
});

const fakeBot = { sendMessage: vi.fn(), listen: vi.fn(), close: vi.fn() };

describe('EventSubscriber', () => {
  let plugin: EventSubscriber;

  beforeEach(() => {
    plugin = new EventSubscriber({ name: 'EventSubscriber', botUsername: 'bot_name', token: 't' });
    plugin['bot'] = fakeBot as any;
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
    const eventTimestamp = toTimestamp('2022-01-01T00:00:00Z');
    const baseOrder = {
      id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e' as UUID,
      side: 'BUY' as const,
      type: 'STICKY' as const,
      amount: 1,
      price: 123,
    };
    const baseExchange = {
      price: 123,
      balance: { free: 1, used: 0, total: 1 },
      portfolio: {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 0, used: 0, total: 0 },
      },
    };
    const onStrategyInfo = (p: EventSubscriber) =>
      p.onStrategyInfo([{ timestamp: eventTimestamp, level: 'debug', message: 'M', tag: 'strategy' }]);
    const onStrategyCreateOrder = (p: EventSubscriber, overrides: Partial<AdviceOrder> = {}) =>
      p.onStrategyCreateOrder([
        {
          ...baseOrder,
          orderCreationDate: eventTimestamp,
          ...overrides,
        },
      ]);
    const makeOrderInitiatedEvent = (
      overrides: {
        order?: Partial<OrderInitiatedEvent['order']>;
        exchange?: Partial<OrderInitiatedEvent['exchange']>;
      } = {},
    ): OrderInitiatedEvent => ({
      order: { ...baseOrder, orderCreationDate: eventTimestamp, ...overrides.order },
      exchange: { ...baseExchange, ...overrides.exchange },
    });
    const onOrderInitiated = (p: EventSubscriber, overrides = {}) =>
      p.onOrderInitiated([makeOrderInitiatedEvent(overrides)]);
    const makeOrderCanceledEvent = (
      overrides: {
        order?: Partial<OrderCanceledEvent['order']>;
        exchange?: Partial<OrderCanceledEvent['exchange']>;
      } = {},
    ): OrderCanceledEvent => {
      const initiated = makeOrderInitiatedEvent(overrides);
      return {
        ...initiated,
        order: {
          ...initiated.order,
          orderCancelationDate: eventTimestamp,
          filled: 1,
          remaining: 1,
          ...overrides.order,
        },
        exchange: { ...initiated.exchange, ...overrides.exchange },
      };
    };
    const onOrderCanceled = (p: EventSubscriber, overrides = {}) =>
      p.onOrderCanceled([makeOrderCanceledEvent(overrides)]);
    const makeOrderErroredEvent = (
      overrides: {
        order?: Partial<OrderErroredEvent['order']>;
        exchange?: Partial<OrderErroredEvent['exchange']>;
      } = {},
    ): OrderErroredEvent => {
      const initiated = makeOrderInitiatedEvent(overrides);
      return {
        ...initiated,
        order: {
          ...initiated.order,
          reason: 'r',
          orderErrorDate: eventTimestamp,
          ...overrides.order,
        },
        exchange: { ...initiated.exchange, ...overrides.exchange },
      };
    };
    const onOrderErrored = (p: EventSubscriber, overrides = {}) => p.onOrderErrored([makeOrderErroredEvent(overrides)]);
    const makeOrderCompletedEvent = (
      overrides: {
        order?: Partial<OrderCompletedEvent['order']>;
        exchange?: Partial<OrderCompletedEvent['exchange']>;
      } = {},
    ): OrderCompletedEvent => {
      const initiated = makeOrderInitiatedEvent(overrides);
      return {
        ...initiated,
        order: {
          ...initiated.order,
          orderExecutionDate: eventTimestamp,
          effectivePrice: 1,
          fee: 1,
          feePercent: 0.1,
          ...overrides.order,
        },
        exchange: { ...initiated.exchange, ...overrides.exchange },
      };
    };
    const onOrderCompleted = (p: EventSubscriber, overrides = {}) =>
      p.onOrderCompleted([makeOrderCompletedEvent(overrides)]);
    it.each`
      name                 | handler
      ${'strategy_info'}   | ${onStrategyInfo}
      ${'strategy_advice'} | ${onStrategyCreateOrder}
      ${'order_initiated'} | ${onOrderInitiated}
      ${'order_canceled'}  | ${onOrderCanceled}
      ${'order_errored'}   | ${onOrderErrored}
      ${'order_completed'} | ${onOrderCompleted}
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
      onStrategyCreateOrder(plugin, { type: 'MARKET', side: 'SELL', amount: 3 });
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('MARKET SELL advice'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested amount: 3'));
    });

    it('reports trade initiation details including order type and requested amount', () => {
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/subscribe_to_order_initiated');
      onOrderInitiated(plugin, {
        order: { type: 'MARKET', amount: 5, price: 321 },
        exchange: {
          balance: { free: 10, used: 0, total: 10 },
          portfolio: {
            asset: { free: 1, used: 0, total: 1 },
            currency: { free: 2, used: 0, total: 2 },
          },
        },
      });
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('MARKET order created (ee21e130-48bc-405f-be0c-46e9bf17b52e)'),
      );
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested amount: 5'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested limit price: 321 USD'));
    });

    it('includes fill details when reporting canceled orders', () => {
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/subscribe_to_order_canceled');
      onOrderCanceled(plugin, {
        order: { type: 'LIMIT', side: 'SELL', amount: 2, filled: 1, remaining: 1, price: 999 },
      });
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Filled amount: 1 / 2 BTC'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested limit price: 999 USD'));
    });
  });

  describe('commands', () => {
    it.each`
      preSubscribed | expected
      ${false}      | ${'Subscribed to order_initiated'}
      ${true}       | ${'Unsubscribed from order_initiated'}
    `('toggles subscription', ({ preSubscribed, expected }) => {
      if (preSubscribed) plugin['handleCommand']('/subscribe_to_order_initiated');
      const res = plugin['handleCommand']('/subscribe_to_order_initiated');
      expect(res).toBe(expected);
    });

    it.each`
      setup                                                             | expected
      ${() => undefined}                                                | ${'No subscriptions'}
      ${() => plugin['handleCommand']('/subscribe_to_order_initiated')} | ${'order_initiated'}
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
/subscribe_to_order_initiated
/subscribe_to_order_canceled
/subscribe_to_order_errored
/subscribe_to_order_completed
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
