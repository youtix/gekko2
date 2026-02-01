import { AdviceOrder } from '@models/advice.types';
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { BalanceDetail } from '@models/portfolio.types';
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
      getWatch: vi.fn(() => ({
        pairs: [{ symbol: 'BTC/USD', timeframe: '1m' }],
        mode: 'realtime',
        warmup: {},
      })),
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
  `('updates price on processOneMinuteBucket', ({ close }) => {
    const bucket = new Map([['BTC/USD', { close }]]);
    plugin['processOneMinuteBucket'](bucket as any);
    expect(plugin['prices'].get('BTC/USD')).toBe(close);
  });

  describe('event notifications', () => {
    const eventTimestamp = toTimestamp('2022-01-01T00:00:00Z');
    const symbol = 'BTC/USD' as any;
    const baseOrder = {
      id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e' as UUID,
      side: 'BUY' as const,
      type: 'STICKY' as const,
      amount: 1,
      price: 123,
      symbol,
    };
    const baseExchange = {
      price: 123,
      balance: { free: 1, used: 0, total: 1 },
      portfolio: new Map<string, BalanceDetail>([
        ['asset', { free: 0, used: 0, total: 0 }],
        ['currency', { free: 0, used: 0, total: 0 }],
      ]),
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
    const onOrderInitiated = (p: EventSubscriber, overrides = {}) => p.onOrderInitiated([makeOrderInitiatedEvent(overrides)]);
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
    const onOrderCanceled = (p: EventSubscriber, overrides = {}) => p.onOrderCanceled([makeOrderCanceledEvent(overrides)]);
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
    const onOrderCompleted = (p: EventSubscriber, overrides = {}) => p.onOrderCompleted([makeOrderCompletedEvent(overrides)]);
    it.each`
      name                | handler
      ${'strat_info'}     | ${onStrategyInfo}
      ${'strat_create'}   | ${onStrategyCreateOrder}
      ${'order_init'}     | ${onOrderInitiated}
      ${'order_cancel'}   | ${onOrderCanceled}
      ${'order_error'}    | ${onOrderErrored}
      ${'order_complete'} | ${onOrderCompleted}
    `('sends message only when subscribed for $name', ({ name, handler }) => {
      fakeBot.sendMessage.mockReset();
      handler(plugin);
      plugin['handleCommand'](`/sub_${name}`);
      handler(plugin);
      expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('formats strategy advice message with order metadata', () => {
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/sub_strat_create');
      onStrategyCreateOrder(plugin, { type: 'MARKET', side: 'SELL', amount: 3 });
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('MARKET SELL advice'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Requested amount: 3'));
    });

    it('reports trade initiation details including order type and requested amount', () => {
      const portfolio = new Map<string, BalanceDetail>();
      portfolio.set('BTC', { free: 1, used: 0, total: 1 });
      portfolio.set('USDT', { free: 2, used: 0, total: 2 });
      fakeBot.sendMessage.mockReset();
      plugin['handleCommand']('/sub_order_init');
      onOrderInitiated(plugin, {
        order: { type: 'MARKET', amount: 5, price: 321 },
        exchange: {
          balance: { free: 10, used: 0, total: 10 },
          portfolio,
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
      plugin['handleCommand']('/sub_order_cancel');
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
      ${false}      | ${'Subscribed to order_init'}
      ${true}       | ${'Unsubscribed from order_init'}
    `('toggles subscription', ({ preSubscribed, expected }) => {
      if (preSubscribed) plugin['handleCommand']('/sub_order_init');
      const res = plugin['handleCommand']('/sub_order_init');
      expect(res).toBe(expected);
    });

    it.each`
      setup                                               | expected
      ${() => undefined}                                  | ${'No subscriptions'}
      ${() => plugin['handleCommand']('/sub_order_init')} | ${'order_init'}
    `('lists subscriptions', ({ setup, expected }) => {
      setup();
      const res = plugin['handleCommand']('/subscriptions');
      expect(res).toContain(expected);
    });

    it.each`
      command             | size
      ${'/subscribe_all'} | ${EVENT_NAMES.length}
    `('subscribes to all', ({ command, size }) => {
      plugin['handleCommand'](command);
      expect(plugin['subscriptions'].size).toBe(size);
    });

    it.each`
      setup                                              | command               | size
      ${() => plugin['handleCommand']('/subscribe_all')} | ${'/unsubscribe_all'} | ${0}
    `('unsubscribes from all', ({ setup, command, size }) => {
      setup();
      plugin['handleCommand'](command);
      expect(plugin['subscriptions'].size).toBe(size);
    });

    it('returns help', () => {
      const res = plugin['handleCommand']('/help');
      expect(res).toBe(`sub_strat_info - Subscribe to strategy logs
sub_strat_create - Notify on strategy order creation
sub_strat_cancel - Notify on strategy order cancellation
sub_order_init - Notify on order initiation
sub_order_cancel - Notify on order cancellation
sub_order_error - Notify on order error
sub_order_complete - Notify on order completion
subscribe_all - Subscribe to all notifications
unsubscribe_all - Unsubscribe from all notifications
subscriptions - View current subscriptions
help - Show help information`);
    });

    it('sends message only when subscribed for strat_cancel', () => {
      fakeBot.sendMessage.mockReset();
      const orderId = 'ee21e130-48bc-405f-be0c-46e9bf17b52e' as UUID;
      plugin.onStrategyCancelOrder([orderId]);
      expect(fakeBot.sendMessage).not.toHaveBeenCalled();
      plugin['handleCommand']('/sub_strat_cancel');
      plugin.onStrategyCancelOrder([orderId]);
      expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Strategy requested order cancellation'));
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining(orderId));
    });
  });

  it('getStaticConfiguration returns meta', () => {
    const meta = EventSubscriber.getStaticConfiguration();
    expect(meta).toMatchObject({ schema: eventSubscriberSchema, name: 'EventSubscriber' });
  });
});
