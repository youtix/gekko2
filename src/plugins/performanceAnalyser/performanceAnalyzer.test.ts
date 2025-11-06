import { PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { Candle } from '@models/candle.types';
import { OrderCompleted } from '@models/order.types';
import { addMinutes } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';

vi.mock('./performanceAnalyzer.utils', () => ({
  logFinalize: vi.fn(),
  logTrade: vi.fn(),
}));

vi.mock('../../services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({ warmup: {} })),
    getStrategy: vi.fn(() => ({})),
  },
}));

describe('PerformanceAnalyzer', () => {
  type PerformanceAnalyzerType = typeof import('./performanceAnalyzer').PerformanceAnalyzer;
  let PerformanceAnalyzer: PerformanceAnalyzerType;
  let analyzer: InstanceType<PerformanceAnalyzerType>;

  const defaultCandle: Candle = {
    close: 100,
    high: 110,
    low: 90,
    open: 95,
    start: toTimestamp('2025-01-01T00:00:00Z'),
    volume: 10,
  };

  const buyTrade: OrderCompleted = {
    side: 'BUY',
    orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    date: toTimestamp('2025-01-01T00:10:00Z'),
    portfolio: { asset: 5, currency: 500 },
    balance: 1000,
    price: 100,
    fee: 500,
    amount: 5,
    effectivePrice: 100,
    feePercent: 0.2,
    type: 'STICKY',
    requestedAmount: 5,
  };

  const sellTrade: OrderCompleted = {
    side: 'SELL',
    orderId: 'dd21e130-48bc-405f-be0c-46e9bf17b111',
    date: toTimestamp('2025-01-01T01:00:00Z'),
    portfolio: { asset: 0, currency: 1500 },
    balance: 1500,
    price: 110,
    fee: 0,
    amount: 5,
    effectivePrice: 110,
    feePercent: 0.2,
    type: 'STICKY',
    requestedAmount: 5,
  };

  beforeEach(async () => {
    ({ PerformanceAnalyzer } = await import('./performanceAnalyzer'));
    analyzer = new PerformanceAnalyzer({ name: 'PerformanceAnalyzer', riskFreeReturn: 5, enableConsoleTable: false });
    analyzer['deferredEmit'] = vi.fn();
    analyzer['emit'] = vi.fn();
  });

  describe('onPortfolioValueChange', () => {
    it('sets balance and start balance when first event arrives', () => {
      analyzer.onPortfolioValueChange({ balance: 2000 });
      expect(analyzer['balance']).toBe(2000);
      expect(analyzer['start'].balance).toBe(2000);
    });

    it('keeps existing start balance on subsequent events', () => {
      analyzer['start'].balance = 1500;
      analyzer.onPortfolioValueChange({ balance: 1800 });
      expect(analyzer['start'].balance).toBe(1500);
      expect(analyzer['balance']).toBe(1800);
    });
  });

  describe('onPortfolioChange', () => {
    it('stores start portfolio when first event arrives', () => {
      const portfolio = { asset: 1, currency: 1000 };
      analyzer.onPortfolioChange(portfolio);
      expect(analyzer['start'].portfolio).toEqual(portfolio);
      expect(analyzer['latestPortfolio']).toEqual(portfolio);
    });

    it('does not overwrite start portfolio once set', () => {
      analyzer['start'].portfolio = { asset: 2, currency: 100 };
      const portfolio = { asset: 10, currency: 200 };
      analyzer.onPortfolioChange(portfolio);
      expect(analyzer['start'].portfolio).toEqual({ asset: 2, currency: 100 });
      expect(analyzer['latestPortfolio']).toEqual(portfolio);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('marks warmup completed, sets start date and price', () => {
      analyzer.onStrategyWarmupCompleted(defaultCandle);
      expect(analyzer['warmupCompleted']).toBe(true);
      expect(analyzer['dates'].start).toBe(defaultCandle.start);
      expect(analyzer['startPrice']).toBe(defaultCandle.close);
    });

    it('processes warmup candle if queued', () => {
      analyzer['warmupCandle'] = defaultCandle;
      const spy = vi.spyOn(analyzer as any, 'processOneMinuteCandle');
      analyzer.onStrategyWarmupCompleted(defaultCandle);
      expect(spy).toHaveBeenCalledWith(defaultCandle);
    });

    it('starts exposure tracking when already holding asset', () => {
      analyzer['start'].portfolio = { asset: 1, currency: 1000 };
      analyzer.onStrategyWarmupCompleted(defaultCandle);
      expect(analyzer['exposureActiveSince']).toBe(defaultCandle.start);
    });
  });

  describe('onOrderCompleted', () => {
    it('increments trade count, balance, and samples', () => {
      analyzer.onOrderCompleted(buyTrade);
      expect(analyzer['orders']).toBe(1);
      expect(analyzer['balance']).toBe(buyTrade.balance);
      expect(analyzer['balanceSamples']).toEqual([{ date: buyTrade.date, balance: buyTrade.balance }]);
    });

    it('starts exposure window when entering a position', () => {
      analyzer.onOrderCompleted(buyTrade);
      expect(analyzer['exposureActiveSince']).toBe(buyTrade.date);
    });

    it('accumulates exposure when exiting a position', () => {
      analyzer.onOrderCompleted(buyTrade);
      analyzer.onOrderCompleted(sellTrade);
      expect(analyzer['exposure']).toBe(sellTrade.date - buyTrade.date);
      expect(analyzer['exposureActiveSince']).toBeNull();
    });
  });

  describe('processOneMinuteCandle', () => {
    it('queues warmup candle until warmup completes', () => {
      analyzer['warmupCompleted'] = false;
      analyzer['processOneMinuteCandle'](defaultCandle);
      expect(analyzer['warmupCandle']).toBe(defaultCandle);
    });

    it('updates end date and price once warmup is done', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['processOneMinuteCandle'](defaultCandle);
      expect(analyzer['dates'].end).toBe(addMinutes(defaultCandle.start, 1).getTime());
      expect(analyzer['endPrice']).toBe(defaultCandle.close);
    });
  });

  describe('processFinalize', () => {
    beforeEach(() => {
      analyzer['start'] = { balance: 1000, portfolio: { asset: 0, currency: 1000 } };
      analyzer['latestPortfolio'] = { asset: 0, currency: 1000 };
      analyzer['balance'] = 1000;
      analyzer['dates'] = {
        start: defaultCandle.start,
        end: addMinutes(defaultCandle.start, 1).getTime(),
      };
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 100;
    });

    it('includes open exposure duration before emitting the report', () => {
      analyzer['exposureActiveSince'] = defaultCandle.start;
      analyzer['processFinalize']();
      expect(analyzer['exposure']).toBe(analyzer['dates'].end - defaultCandle.start);
    });

    it('emits a performance report even when no orders occurred', () => {
      analyzer['processFinalize']();
      expect(analyzer['emit']).toHaveBeenCalledWith(
        PERFORMANCE_REPORT_EVENT,
        expect.objectContaining({
          profit: 0,
          orders: 0,
          balance: 1000,
        }),
      );
    });
  });

  describe('calculateReportStatistics', () => {
    const start = toTimestamp('2025-01-01T00:00:00Z');
    const end = toTimestamp('2026-01-01T00:00:00Z');

    beforeEach(() => {
      analyzer['start'] = { balance: 1000, portfolio: { asset: 0, currency: 1000 } };
      analyzer['latestPortfolio'] = { asset: 0, currency: 990 };
      analyzer['balance'] = 990;
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 100;
      analyzer['dates'] = { start, end };
      analyzer['balanceSamples'] = [
        { date: start + 1, balance: 1100 },
        { date: start + 2, balance: 990 },
      ];
      analyzer['orders'] = 2;
      analyzer['exposure'] = (end - start) / 2;
    });

    it('derives metrics from balance samples', () => {
      const report = analyzer['calculateReportStatistics']();
      expect(report).toBeDefined();
      expect(report?.balance).toBe(990);
      expect(report?.profit).toBe(-10);
      expect(report?.relativeProfit).toBeCloseTo(-1);
      expect(report?.yearlyProfit).toBeCloseTo(-10);
      expect(report?.exposure).toBeCloseTo(50);
      expect(report?.standardDeviation).toBeCloseTo(10);
      expect(report?.sharpe).toBeCloseTo((-1 - 5) / 10);
      expect(report?.downside).toBeCloseTo(Math.sqrt(2) * -10);
      expect(report?.sortino).toBe(0);
      expect(report?.alpha).toBeCloseTo(-1);
    });

    it('marks open positions to market using the end price', () => {
      analyzer['latestPortfolio'] = { asset: 1, currency: 100 };
      analyzer['balance'] = 100;
      analyzer['endPrice'] = 200;
      const report = analyzer['calculateReportStatistics']();
      expect(report?.balance).toBe(300);
      expect(report?.profit).toBe(300 - 1000);
    });

    it('returns zeroed volatility metrics when no orders were executed', () => {
      analyzer['balanceSamples'] = [];
      analyzer['orders'] = 0;
      analyzer['balance'] = 1000;
      analyzer['latestPortfolio'] = analyzer['start'].portfolio;
      const report = analyzer['calculateReportStatistics']();
      expect(report?.standardDeviation).toBe(0);
      expect(report?.sharpe).toBe(0);
      expect(report?.sortino).toBe(0);
      expect(report?.downside).toBe(0);
    });
  });
});
