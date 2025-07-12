import { formatDuration, intervalToDuration } from 'date-fns';
import { upperCase } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { RoundTrip } from '../../models/types/roundtrip.types';
import {
  TradeAborted,
  TradeCanceled,
  TradeCompleted,
  TradeErrored,
  TradeInitiated,
} from '../../models/types/tradeStatus.types';
import { toISOString, toTimestamp } from '../../utils/date/date.utils';
import { round } from '../../utils/math/round.utils';
import { Telegram } from './telegram';
import { telegramSchema } from './telegram.schema';

vi.mock('../../services/logger', () => ({ debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'realtime' })),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('Telegram', () => {
  let telegram: Telegram;

  beforeEach(() => {
    telegram = new Telegram({ name: 'Telegram', chatId: 123, token: 'abc' });
    telegram['asset'] = 'BTC';
    telegram['currency'] = 'USD';
  });

  describe('processOneMinuteCandle', () => {
    it.each`
      candle              | expectedPrice
      ${{ close: 100 }}   | ${100}
      ${{ close: 150.5 }} | ${150.5}
    `('should set price to candle.close when candle.close is $candleClose', ({ candle, expectedPrice }) => {
      telegram['processOneMinuteCandle'](candle);
      expect(telegram['price']).toBe(expectedPrice);
    });
  });

  describe('onStrategyAdvice', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 250;
      const advice: Advice = { id: 'advice-1', recommendation: 'long', date: toTimestamp('2022-01-01T12:00:00Z') };
      telegram['sendMessage'] = vi.fn();
      telegram.onStrategyAdvice(advice);
      const expectedMessage = [
        `Received advice to go ${advice.recommendation}`,
        `At time: ${toISOString(advice.date)}`,
        `Target price: ${telegram['price']}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onTradeInitiated', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 300;
      const tradeInitiated: TradeInitiated = {
        action: 'buy',
        balance: 1000,
        date: toTimestamp('2022-01-02T15:00:00Z'),
        id: 'order1',
        adviceId: 'adv1',
        portfolio: { asset: 2, currency: 500 },
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onTradeInitiated(tradeInitiated);
      const expectedMessage = [
        `${upperCase(tradeInitiated.action)} sticky order created (${tradeInitiated.id})`,
        `Current portfolio: ${tradeInitiated.portfolio.asset} ${telegram['asset']} / ${tradeInitiated.portfolio.currency} ${telegram['currency']}`,
        `Current balance: ${tradeInitiated.balance}`,
        `Target price: ${telegram['price']}`,
        `At time: ${toISOString(tradeInitiated.date)}`,
        `Advice: ${tradeInitiated.adviceId}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onTradeCanceled', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 350;
      const tradeCanceled: TradeCanceled = {
        id: 'order2',
        date: toTimestamp('2022-01-03T10:00:00Z'),
        adviceId: 'adv2',
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onTradeCanceled(tradeCanceled);
      const expectedMessage = [
        `Sticky order canceled (${tradeCanceled.id})`,
        `At time: ${toISOString(tradeCanceled.date)}`,
        `Current price: ${telegram['price']} ${telegram['currency']}`,
        `Advice: ${tradeCanceled.adviceId}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onTradeAborted', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 400;
      const tradeAborted: TradeAborted = {
        id: 'order3',
        action: 'sell',
        adviceId: 'adv3',
        balance: 800,
        date: toTimestamp('2022-01-04T11:00:00Z'),
        portfolio: { asset: 3, currency: 600 },
        reason: 'Insufficient funds',
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onTradeAborted(tradeAborted);
      const expectedMessage = [
        `${upperCase(tradeAborted.action)} sticky order aborted (${tradeAborted.id})`,
        `Due to ${tradeAborted.reason}`,
        `At time: ${toISOString(tradeAborted.date)}`,
        `Current portfolio: ${tradeAborted.portfolio.asset} ${telegram['asset']} / ${tradeAborted.portfolio.currency} ${telegram['currency']}`,
        `Current balance: ${tradeAborted.balance}`,
        `Current price: ${telegram['price']} ${telegram['currency']}`,
        `Advice: ${tradeAborted.adviceId}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onTradeErrored', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 450;
      const tradeErrored: TradeErrored = {
        id: 'order4',
        adviceId: 'adv4',
        date: toTimestamp('2022-01-05T12:00:00Z'),
        reason: 'Timeout',
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onTradeErrored(tradeErrored);
      const expectedMessage = [
        `Sticky order errored (${tradeErrored.id})`,
        `Due to ${tradeErrored.reason}`,
        `At time: ${toISOString(tradeErrored.date)}`,
        `Current price: ${telegram['price']} ${telegram['currency']}`,
        `Advice: ${tradeErrored.adviceId}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onTradeCompleted', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['price'] = 500;
      const tradeCompleted: TradeCompleted = {
        action: 'buy',
        adviceId: 'adv5',
        amount: 10,
        balance: 2000,
        cost: 1500,
        date: toTimestamp('2022-01-06T13:00:00Z'),
        effectivePrice: 155,
        feePercent: 0.5,
        id: 'order5',
        portfolio: { asset: 4, currency: 800 },
        price: 150,
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onTradeCompleted(tradeCompleted);
      const expectedMessage = [
        `${upperCase(tradeCompleted.action)} sticky order completed (${tradeCompleted.id})`,
        `Amount: ${tradeCompleted.amount} ${telegram['asset']}`,
        `Price: ${tradeCompleted.effectivePrice} ${telegram['currency']}`,
        `Fee percent: ${tradeCompleted.feePercent}%`,
        `Cost: ${tradeCompleted.cost} ${telegram['currency']}`,
        `At time: ${toISOString(tradeCompleted.date)}`,
        `Current portfolio: ${tradeCompleted.portfolio.asset} ${telegram['asset']} / ${tradeCompleted.portfolio.currency} ${telegram['currency']}`,
        `Current balance: ${tradeCompleted.balance}`,
        `Advice: ${tradeCompleted.adviceId}`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('onRoundtrip', () => {
    it('should call sendMessage with the correct message', () => {
      telegram['currency'] = 'USD';
      const roundtrip: RoundTrip = {
        id: 0,
        entryBalance: 100,
        entryPrice: 155,
        exitBalance: 200,
        exitPrice: 200,
        maxAdverseExcursion: 0,
        duration: 3600000, // 1 hour in ms
        entryAt: toTimestamp('2022-01-07T10:00:00Z'),
        exitAt: toTimestamp('2022-01-07T11:00:00Z'),
        pnl: 1234.56,
        profit: 12.3456,
      };
      telegram['sendMessage'] = vi.fn();
      telegram.onRoundtrip(roundtrip);
      const formater = new Intl.NumberFormat();
      const expectedMessage = [
        `Roundtrip done from ${toISOString(roundtrip.entryAt)} to ${toISOString(roundtrip.exitAt)}`,
        `Exposed Duration: ${formatDuration(intervalToDuration({ start: 0, end: roundtrip.duration }))}`,
        `Profit & Loss: ${formater.format(roundtrip.pnl)} ${telegram['currency']}`,
        `Profit percent: ${round(roundtrip.profit, 2, 'down')}%`,
        `MAE: ${round(roundtrip.maxAdverseExcursion, 2, 'down')}%`,
      ].join('\n');
      expect(telegram['sendMessage']).toHaveBeenCalledWith(123, expectedMessage);
    });
  });

  describe('sendMessage', () => {
    it('should call bot.sendMessage with correct arguments', async () => {
      const fakeBot = { sendMessage: vi.fn().mockResolvedValue('result'), listen: vi.fn(), close: vi.fn() };
      telegram['bot'] = fakeBot as any;
      const message = 'Test message';
      const result = await telegram['sendMessage'](123, message);
      expect(fakeBot.sendMessage).toHaveBeenCalledWith(123, message);
      expect(result).toBe('result');
    });

    it('should catch errors and return undefined', async () => {
      const fakeBot = { sendMessage: vi.fn().mockRejectedValue(new Error('fail')), listen: vi.fn(), close: vi.fn() };
      telegram['bot'] = fakeBot as any;
      expect(await telegram['sendMessage'](123, 'message')).toBeUndefined();
    });
  });

  describe('getStaticConfiguration', () => {
    const config = Telegram.getStaticConfiguration();
    it('should return the correct schema', () => {
      expect(config.schema).toBe(telegramSchema);
    });
    it('should return modes equal to ["realtime"]', () => {
      expect(config.modes).toEqual(['realtime']);
    });
    it('should return dependencies as an empty array', () => {
      expect(config.dependencies).toEqual([]);
    });
    it('should return inject equal to ["fetcher"]', () => {
      expect(config.inject).toEqual(['fetcher']);
    });
    it('should return eventsHandlers containing all methods starting with "on"', () => {
      const expectedHandlers = Object.getOwnPropertyNames(Telegram.prototype).filter(p => p.startsWith('on'));
      expect(config.eventsHandlers).toEqual(expectedHandlers);
    });
    it('should return eventsEmitted as an empty array', () => {
      expect(config.eventsEmitted).toEqual([]);
    });
    it('should return name equal to Telegram.name', () => {
      expect(config.name).toBe(Telegram.name);
    });
  });
});
