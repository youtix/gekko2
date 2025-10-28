import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/advice.types';
import { RoundTrip } from '../../models/roundtrip.types';
import {
  TradeAborted,
  TradeCanceled,
  TradeCompleted,
  TradeErrored,
  TradeInitiated,
} from '../../models/tradeStatus.types';
import { toTimestamp } from '../../utils/date/date.utils';
import { EventSubscriber } from './eventSubscriber';
import { eventSubscriberSchema } from './eventSubscriber.schema';
import { EVENT_NAMES } from './eventSubscriber.types';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'realtime' })),
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
    const onStrategyAdvice = (p: EventSubscriber) =>
      p.onStrategyAdvice({ recommendation: 'long', date: toTimestamp('2022-01-01T00:00:00Z') } as Advice);
    const onTradeInitiated = (p: EventSubscriber) =>
      p.onTradeInitiated({
        action: 'BUY',
        balance: 1,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        id: '1',
        adviceId: 'a1',
        portfolio: { asset: 0, currency: 0 },
      } as TradeInitiated);
    const onTradeCanceled = (p: EventSubscriber) =>
      p.onTradeCanceled({ id: '1', date: toTimestamp('2022-01-01T00:00:00Z'), adviceId: 'a1' } as TradeCanceled);
    const onTradeAborted = (p: EventSubscriber) =>
      p.onTradeAborted({
        id: '1',
        action: 'BUY',
        adviceId: 'a1',
        balance: 0,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        portfolio: { asset: 0, currency: 0 },
        reason: 'r',
      } as TradeAborted);
    const onTradeErrored = (p: EventSubscriber) =>
      p.onTradeErrored({
        id: '1',
        adviceId: 'a1',
        date: toTimestamp('2022-01-01T00:00:00Z'),
        reason: 'r',
      } as TradeErrored);
    const onTradeCompleted = (p: EventSubscriber) =>
      p.onTradeCompleted({
        action: 'BUY',
        adviceId: 'a1',
        amount: 1,
        balance: 1,
        cost: 1,
        date: toTimestamp('2022-01-01T00:00:00Z'),
        effectivePrice: 1,
        id: '1',
        portfolio: { asset: 0, currency: 0 },
      } as TradeCompleted);
    const onRoundtrip = (p: EventSubscriber) =>
      p.onRoundtrip({
        id: 1,
        entryBalance: 0,
        entryPrice: 0,
        exitBalance: 0,
        exitPrice: 0,
        maxAdverseExcursion: 0,
        duration: 0,
        entryAt: toTimestamp('2022-01-01T00:00:00Z'),
        exitAt: toTimestamp('2022-01-01T01:00:00Z'),
        pnl: 0,
        profit: 0,
      } as RoundTrip);

    it.each`
      name                 | handler
      ${'strategy_info'}   | ${onStrategyInfo}
      ${'strategy_advice'} | ${onStrategyAdvice}
      ${'trade_initiated'} | ${onTradeInitiated}
      ${'trade_canceled'}  | ${onTradeCanceled}
      ${'trade_aborted'}   | ${onTradeAborted}
      ${'trade_errored'}   | ${onTradeErrored}
      ${'trade_completed'} | ${onTradeCompleted}
      ${'roundtrip'}       | ${onRoundtrip}
    `('sends message only when subscribed for $name', ({ name, handler }) => {
      handler(plugin);
      plugin['handleCommand'](`/subscribe_to_${name}`);
      handler(plugin);
      expect(fakeBot.sendMessage).toHaveBeenCalledTimes(1);
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
/subscribe_to_roundtrip
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
