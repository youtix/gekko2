import { PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { Candle } from '@models/candle.types';
import { OrderCompletedEvent } from '@models/event.types';
import { warning } from '@services/logger';
import { addMinutes } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';
import { logFinalize, logTrade } from './performanceAnalyzer.utils';

// Mocks
vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({ asset: 'BTC', currency: 'USD', warmup: { candleCount: 0 } })),
    getStrategy: vi.fn(() => ({})),
  },
}));
vi.mock('./performanceAnalyzer.utils', () => ({
  logFinalize: vi.fn(),
  logTrade: vi.fn(),
}));

describe('PerformanceAnalyzer', () => {
  let PerformanceAnalyzer: any;
  let analyzer: any;

  // Test Data
  const timestamp = toTimestamp('2025-01-01T00:00:00Z');
  const defaultCandle: Candle = {
    close: 100,
    high: 110,
    low: 90,
    open: 95,
    start: timestamp,
    volume: 10,
  };

  const createOrder = (
    side: 'BUY' | 'SELL',
    price: number,
    amount: number,
    date: number,
    balance: number,
    assetP: number,
    currP: number,
  ): OrderCompletedEvent => ({
    order: {
      id: '00000000-0000-0000-0000-000000000000',
      side,
      type: 'STICKY',
      amount,
      price,
      orderCreationDate: date - 60000,
      orderExecutionDate: date,
      effectivePrice: price,
      fee: 0,
      feePercent: 0,
    },
    exchange: {
      portfolio: {
        asset: { free: assetP, used: 0, total: assetP },
        currency: { free: currP, used: 0, total: currP },
      },
      balance: { free: balance, used: 0, total: balance },
      price,
    },
  });

  beforeEach(async () => {
    const mod = await import('./performanceAnalyzer');
    PerformanceAnalyzer = mod.PerformanceAnalyzer;
    analyzer = new PerformanceAnalyzer({ name: 'PA', riskFreeReturn: 0, enableConsoleTable: false });
    // Mock emit to prevent side effects
    analyzer.emit = vi.fn();
  });

  describe('Static Configuration', () => {
    it('should return correct static configuration', () => {
      const config = PerformanceAnalyzer.getStaticConfiguration();
      expect(config).toEqual({
        name: 'PerformanceAnalyzer',
        schema: performanceAnalyzerSchema,
        modes: ['realtime', 'backtest'],
        dependencies: [],
        inject: [],
        eventsHandlers: expect.arrayContaining([
          'onPortfolioValueChange',
          'onPortfolioChange',
          'onStrategyWarmupCompleted',
          'onOrderCompleted',
        ]),
        eventsEmitted: [PERFORMANCE_REPORT_EVENT],
      });
    });
  });

  describe('Lifecycle: processInit', () => {
    it('should execution without error (noop)', () => {
      expect(() => analyzer['processInit']()).not.toThrow();
    });
  });

  describe('onPortfolioValueChange', () => {
    it.each([
      { initialBalance: 0, newBalance: 1000, expectedStart: 1000, expectedCurrent: 1000 },
      { initialBalance: 500, newBalance: 1000, expectedStart: 500, expectedCurrent: 1000 },
    ])(
      'should set balance to $newBalance (start: $expectedStart)',
      ({ initialBalance, newBalance, expectedStart, expectedCurrent }) => {
        if (initialBalance) analyzer['start'].balance = initialBalance;

        analyzer.onPortfolioValueChange([{ balance: { free: newBalance, used: 0, total: newBalance } }]);

        expect(analyzer['start'].balance).toBe(expectedStart);
        expect(analyzer['balance']).toBe(expectedCurrent);
      },
    );
  });

  describe('onPortfolioChange', () => {
    const p1 = {
      asset: { free: 1, used: 0, total: 1 },
      currency: { free: 100, used: 0, total: 100 },
    };
    const p2 = {
      asset: { free: 2, used: 0, total: 2 },
      currency: { free: 200, used: 0, total: 200 },
    };

    it.each`
      initialStart | newPortfolio | expectedStart | expectedLatest
      ${null}      | ${p1}        | ${p1}         | ${p1}
      ${p1}        | ${p2}        | ${p1}         | ${p2}
    `('should update portfolio correctly', ({ initialStart, newPortfolio, expectedStart, expectedLatest }) => {
      if (initialStart) analyzer['start'].portfolio = initialStart;

      analyzer.onPortfolioChange([newPortfolio]);

      expect(analyzer['start'].portfolio).toEqual(expectedStart);
      expect(analyzer['latestPortfolio']).toEqual(expectedLatest);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('should set start date, start price and process queued warmup candle', () => {
      const processSpy = vi.spyOn(analyzer as any, 'processOneMinuteCandle');
      analyzer['warmupCandle'] = defaultCandle;

      analyzer.onStrategyWarmupCompleted([defaultCandle]);

      expect(analyzer['warmupCompleted']).toBe(true);
      expect(analyzer['dates'].start).toBe(defaultCandle.start);
      expect(analyzer['startPrice']).toBe(defaultCandle.close);
      expect(processSpy).toHaveBeenCalledWith(defaultCandle);
    });

    it('should set exposureActiveSince if currently holding asset', () => {
      analyzer['latestPortfolio'] = {
        asset: { free: 1, used: 0, total: 1 },
        currency: { free: 0, used: 0, total: 0 },
      };

      analyzer.onStrategyWarmupCompleted([defaultCandle]);

      expect(analyzer['exposureActiveSince']).toBe(defaultCandle.start);
    });

    it('should NOT set exposureActiveSince if NOT holding asset', () => {
      analyzer['latestPortfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 1000 },
      };

      analyzer.onStrategyWarmupCompleted([defaultCandle]);

      expect(analyzer['exposureActiveSince']).toBeNull();
    });
  });

  describe('onOrderCompleted', () => {
    const buy = createOrder('BUY', 100, 1, 1000, 1000, 1, 0);
    const sell = createOrder('SELL', 110, 1, 2000, 1100, 0, 1100);

    it('should update stats, log trade and track samples', () => {
      analyzer.onOrderCompleted([buy]);

      expect(analyzer['orders']).toBe(1);
      expect(analyzer['balance']).toBe(1000);
      expect(analyzer['latestPortfolio']).toEqual(buy.exchange.portfolio);
      expect(analyzer['balanceSamples']).toHaveLength(1);
      expect(logTrade).toHaveBeenCalled();
    });

    it('should accumulate exposure when exiting a position (SELL)', () => {
      analyzer.onOrderCompleted([buy]);
      analyzer.onOrderCompleted([sell]);

      expect(analyzer['exposure']).toBe(sell.order.orderExecutionDate - buy.order.orderExecutionDate);
      expect(analyzer['exposureActiveSince']).toBeNull();
    });

    it.each`
      scenario       | initialExposure | newPortfolioAsset | expectedExposureStart | expectedExposureAdded
      ${'Start Exp'} | ${null}         | ${1}              | ${1000}               | ${0}
      ${'End Exp'}   | ${500}          | ${0}              | ${null}               | ${1000 - 500}
      ${'Cont Exp'}  | ${500}          | ${1}              | ${500}                | ${0}
      ${'No Exp'}    | ${null}         | ${0}              | ${null}               | ${0}
    `(
      'should handle exposure for $scenario',
      ({ initialExposure, newPortfolioAsset, expectedExposureStart, expectedExposureAdded }) => {
        analyzer['exposureActiveSince'] = initialExposure;
        const order = createOrder('BUY', 100, 1, 1000, 1000, newPortfolioAsset, 0);

        analyzer.onOrderCompleted([order]);

        expect(analyzer['exposureActiveSince']).toBe(expectedExposureStart);
        if (expectedExposureAdded > 0) {
          expect(analyzer['exposure']).toBe(expectedExposureAdded);
        }
      },
    );
  });

  describe('processOneMinuteCandle', () => {
    it.each`
      warmupCompleted | expectedWarmupCandle | expectedEndDate
      ${false}        | ${defaultCandle}     | ${0}
      ${true}         | ${undefined}         | ${addMinutes(defaultCandle.start, 1).getTime()}
    `(
      'should handle candle (warmupCompleted: $warmupCompleted)',
      ({ warmupCompleted, expectedWarmupCandle, expectedEndDate }) => {
        analyzer['warmupCompleted'] = warmupCompleted;

        analyzer['processOneMinuteCandle'](defaultCandle);

        expect(analyzer['warmupCandle']).toEqual(expectedWarmupCandle);
        if (warmupCompleted) {
          expect(analyzer['dates'].end).toBe(expectedEndDate);
          expect(analyzer['endPrice']).toBe(defaultCandle.close);
        }
      },
    );
  });

  describe('processFinalize', () => {
    it('should log warning if no start balance', () => {
      analyzer['start'].balance = 0;
      analyzer['processFinalize']();
      expect(warning).toHaveBeenCalled();
      expect(analyzer.emit).not.toHaveBeenCalled();
    });

    it('should finalize exposure if active', () => {
      analyzer['start'] = {
        balance: 1000,
        portfolio: {
          asset: { free: 0, used: 0, total: 0 },
          currency: { free: 1000, used: 0, total: 1000 },
        },
      };
      analyzer['exposureActiveSince'] = 1000;
      analyzer['dates'].end = 2000;

      analyzer['processFinalize']();

      expect(analyzer['exposure']).toBe(1000); // 2000 - 1000
      expect(analyzer['exposureActiveSince']).toBeNull();
      expect(logFinalize).toHaveBeenCalled();
      expect(analyzer.emit).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, expect.any(Object));
    });

    it('should emit report if valid', () => {
      analyzer['start'] = {
        balance: 1000,
        portfolio: {
          asset: { free: 0, used: 0, total: 0 },
          currency: { free: 1000, used: 0, total: 1000 },
        },
      };
      analyzer['processFinalize']();
      expect(analyzer.emit).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, expect.any(Object));
    });
  });

  describe('calculateReportStatistics', () => {
    const setupAnalyzer = (
      balance: number,
      startBalance: number,
      startPortfolio: any = { asset: 0, currency: startBalance },
      latestPortfolio: any | null = null,
      endPrice: number = 100,
      samples: any[] = [],
    ) => {
      const fullStartPortfolio = {
        asset: { free: startPortfolio.asset as any, used: 0, total: startPortfolio.asset as any },
        currency: { free: startPortfolio.currency as any, used: 0, total: startPortfolio.currency as any },
      };
      const fullLatestPortfolio = latestPortfolio
        ? {
            asset: { free: latestPortfolio.asset as any, used: 0, total: latestPortfolio.asset as any },
            currency: { free: latestPortfolio.currency as any, used: 0, total: latestPortfolio.currency as any },
          }
        : fullStartPortfolio;

      analyzer['balance'] = balance;
      analyzer['start'] = { balance: startBalance, portfolio: fullStartPortfolio };
      analyzer['latestPortfolio'] = fullLatestPortfolio;
      analyzer['endPrice'] = endPrice;
      analyzer['dates'] = { start: timestamp, end: timestamp + 31536000000 }; // 1 Year
      analyzer['balanceSamples'] = samples;
    };

    it('should return undefined if no start data', () => {
      analyzer['start'] = { balance: 0, portfolio: null };
      expect(analyzer['calculateReportStatistics']()).toBeUndefined();
    });

    it('should calculate basic profit correctly', () => {
      setupAnalyzer(1100, 1000, undefined, { asset: 0, currency: 1100 });
      const report = analyzer['calculateReportStatistics']();
      expect(report.profit).toBe(100);
      expect(report.relativeProfit).toBeCloseTo(10);
      expect(report.yearlyProfit).toBeCloseTo(100);
    });

    it('should use mark to market balance if holding assets', () => {
      // Holding 1 asset, price goes to 200. Start: 100 cash.
      const startP = { asset: 1, currency: 0 }; // implicitly bought at start? Or just start with it.
      // If we start with 1 asset at price 100 (startPrice), start balance = 100 (if calculated logic was different, but here it's explicit).
      // Let's say start balance 100.
      // End: still holding 1 asset, end price 200.
      setupAnalyzer(100, 100, startP, startP, 200);

      const report = analyzer['calculateReportStatistics']();
      expect(report.balance).toBe(200); // 1 * 200 + 0
      expect(report.profit).toBe(100); // 200 - 100
    });

    it('should calculate volatility metrics (Sharpe, Sortino)', () => {
      const samples = [
        { date: timestamp + 1000, balance: 1010 }, // +1%
        { date: timestamp + 2000, balance: 1020.1 }, // +1%
      ];
      // Start 1000. Returns: 1%, 1%. Avg 1%. Stdev 0.
      // If stdev 0, sharpe 0.
      setupAnalyzer(1020.1, 1000, undefined, undefined, 100, samples);
      analyzer['riskFreeReturn'] = 0;

      let report = analyzer['calculateReportStatistics']();
      expect(report.standardDeviation).toBe(0);
      expect(report.sharpe).toBe(0);

      // Add volatility
      const samples2 = [
        { date: timestamp + 1000, balance: 1100 }, // +10%
        { date: timestamp + 2000, balance: 990 }, // -10% from 1100
      ];
      setupAnalyzer(990, 1000, undefined, undefined, 100, samples2);
      report = analyzer['calculateReportStatistics']();
      expect(report.standardDeviation).toBeGreaterThan(0);
      // We have a balance decline from 1100 to 990, so maxDrawdown should be positive
      expect(report.maxDrawdown).toBeGreaterThan(0);
    });

    it('should handle zero duration gracefully', () => {
      setupAnalyzer(1000, 1000);
      analyzer['dates'].end = timestamp; // distinct from start? No, same.
      const report = analyzer['calculateReportStatistics']();
      expect(report.yearlyProfit).toBe(0); // avoided Infinity
    });
  });
});
