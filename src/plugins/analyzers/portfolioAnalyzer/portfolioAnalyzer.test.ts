import { EQUITY_SNAPSHOT_EVENT, PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { CandleBucket } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import { createEmptyPortfolio, updateAssetBalance } from '@utils/portfolio/portfolio.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioAnalyzer } from './portfolioAnalyzer';
import { EMPTY_PORTFOLIO_REPORT } from './portfolioAnalyzer.const';

// Mock dependencies
vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
    getStrategy: vi.fn(),
  },
}));

vi.mock('@services/logger', () => ({
  warning: vi.fn(),
  debug: vi.fn(),
}));

describe('PortfolioAnalyzer', () => {
  let analyzer: PortfolioAnalyzer;
  let emitSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock config
    vi.mocked(config.getWatch).mockReturnValue({
      assets: ['BTC', 'ETH'],
      currency: 'USDT',
      timeframe: '1m',
      mode: 'backtest',
      warmup: { candleCount: 0 },
      pairs: [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }],
    } as any);

    analyzer = new PortfolioAnalyzer({ enableConsoleTable: false, name: 'PortfolioAnalyzer', riskFreeReturn: 5 });
    // Spy on addDeferredEmit instead of emit because the plugin uses deferred emission
    emitSpy = vi.spyOn(analyzer, 'addDeferredEmit');
  });

  describe('MTM Valuation', () => {
    const valuationTestCases = [
      {
        description: 'should calculate total value correctly with multiple assets',
        prices: { 'BTC/USDT': 50000, 'ETH/USDT': 3000 },
        portfolio: { BTC: 1, ETH: 2, USDT: 10000 }, // 50k + 6k + 10k = 66k
        expectedEquity: 66000,
      },
      {
        description: 'should handle zero balances',
        prices: { 'BTC/USDT': 50000, 'ETH/USDT': 3000 },
        portfolio: { BTC: 0, ETH: 0, USDT: 1000 },
        expectedEquity: 1000,
      },
    ];

    it.each(valuationTestCases)('$description', ({ prices, portfolio: holdings, expectedEquity }) => {
      // 1. Setup prices
      const bucket = new Map() as CandleBucket;
      Object.entries(prices).forEach(([pair, price]) => {
        bucket.set(pair as any, { start: 1000, open: price, high: price, low: price, close: price, volume: 1 });
      });

      (analyzer as any).processOneMinuteBucket(bucket);

      // 2. Setup portfolio
      const portfolio: Portfolio = createEmptyPortfolio();
      Object.entries(holdings).forEach(([asset, total]) => {
        updateAssetBalance(portfolio, asset as any, { total, free: total, used: 0 });
      });

      // 3. Trigger change
      analyzer.onPortfolioChange([portfolio]);

      expect((analyzer as any).startEquity).toBe(expectedEquity);

      (analyzer as any).warmupCompleted = true;
      analyzer.onPortfolioChange([portfolio]);
      const curve = (analyzer as any).equityCurve;
      expect(curve[curve.length - 1].totalValue).toBe(expectedEquity);
    });

    it('should skip valuation if prices are missing', () => {
      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'BTC', { total: 1, free: 1, used: 0 });

      analyzer.onPortfolioChange([portfolio]);

      expect((analyzer as any).startEquity).toBe(0);
      expect((analyzer as any).equityCurve.length).toBe(0);
    });
  });

  describe('Reporting', () => {
    it('should emit empty report if insufficient data', () => {
      (analyzer as any).processFinalize();

      expect(warning).toHaveBeenCalledWith('portfolio analyzer', expect.stringContaining('Insufficient data'));
      expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, EMPTY_PORTFOLIO_REPORT);
    });

    it('should generate report with correct metrics', () => {
      // 1. Warmup
      const bucket1 = new Map() as CandleBucket;
      bucket1.set('BTC/USDT', { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
      bucket1.set('ETH/USDT', { start: 1000, open: 10, high: 10, low: 10, close: 10, volume: 1 });
      (analyzer as any).onStrategyWarmupCompleted([bucket1]);
      (analyzer as any).processOneMinuteBucket(bucket1);

      // 2. Initial Portfolio
      const p1: Portfolio = createEmptyPortfolio();
      updateAssetBalance(p1, 'USDT', { total: 1000, free: 1000, used: 0 });
      analyzer.onPortfolioChange([p1]);

      // 3. 1 Year Pass
      const bucket2 = new Map() as CandleBucket;
      const oneYearLater = 1000 + 31536000000;
      bucket2.set('BTC/USDT', { start: oneYearLater, open: 110, high: 110, low: 110, close: 110, volume: 1 });
      bucket2.set('ETH/USDT', { start: oneYearLater, open: 10, high: 10, low: 10, close: 10, volume: 1 });
      (analyzer as any).processOneMinuteBucket(bucket2);

      const p2: Portfolio = createEmptyPortfolio();
      updateAssetBalance(p2, 'BTC', { total: 5, free: 5, used: 0 });
      updateAssetBalance(p2, 'USDT', { total: 450, free: 450, used: 0 });
      analyzer.onPortfolioChange([p2]);

      // 4. 2 Years Pass. Price goes up to 200.
      const twoYearsLater = oneYearLater + 31536000000;
      const bucket3 = new Map() as CandleBucket;
      bucket3.set('BTC/USDT', { start: twoYearsLater, open: 200, high: 200, low: 200, close: 200, volume: 1 });
      bucket3.set('ETH/USDT', { start: twoYearsLater, open: 10, high: 10, low: 10, close: 10, volume: 1 });
      (analyzer as any).processOneMinuteBucket(bucket3);

      analyzer.onPortfolioChange([p2]); // Equity = 1450

      // 5. Finalize
      (analyzer as any).processFinalize();

      expect(emitSpy).toHaveBeenCalledWith(
        PERFORMANCE_REPORT_EVENT,
        expect.objectContaining({
          netProfit: 450,
          totalReturnPct: 45,
          benchmarkAsset: 'BTC',
        }),
      );
    });

    it('should handle benchmark return calculation with missing data', () => {
      (analyzer as any).startEquity = 1000;
      // Add Two snapshots to ensure totalMs > 0
      (analyzer as any).recordSnapshot(1000, 1100);
      (analyzer as any).recordSnapshot(2000, 1100);

      // Force startBenchmarkPrice to 0
      (analyzer as any).startBenchmarkPrice = 0;
      (analyzer as any).endBenchmarkPrice = 100;

      const report = (analyzer as any).calculateReportStatistics();
      expect(report.marketReturnPct).toBe(0);
    });
  });

  describe('Events', () => {
    it('should emit equitySnapshot on order completed', () => {
      // Setup
      analyzer['warmupCompleted'] = true;
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT', { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
      bucket.set('ETH/USDT', { start: 1000, open: 10, high: 10, low: 10, close: 10, volume: 1 });
      (analyzer as any).processOneMinuteBucket(bucket);

      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'USDT', { total: 1000, free: 1000, used: 0 });

      // Action
      analyzer.onOrderCompleted([
        {
          order: { orderExecutionDate: 123456789 } as any,
          exchange: { portfolio } as any,
        },
      ]);

      expect(emitSpy).toHaveBeenCalledWith(EQUITY_SNAPSHOT_EVENT, {
        date: 123456789,
        totalValue: 1000,
      });
    });

    it('should not emit snapshot if warmup not completed', () => {
      analyzer['warmupCompleted'] = false;
      const portfolio: Portfolio = createEmptyPortfolio();

      analyzer.onOrderCompleted([
        {
          order: { orderExecutionDate: 123456789 } as any,
          exchange: { portfolio } as any,
        },
      ]);

      expect(emitSpy).not.toHaveBeenCalledWith(EQUITY_SNAPSHOT_EVENT, expect.anything());
    });
  });

  describe('Warmup', () => {
    it('should initialize benchmark on warmup completed', () => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT', { start: 5000, open: 100, high: 100, low: 100, close: 12345, volume: 1 });

      expect((analyzer as any).warmupCompleted).toBe(false);

      analyzer.onStrategyWarmupCompleted([bucket]);

      expect((analyzer as any).warmupCompleted).toBe(true);
      expect((analyzer as any).startBenchmarkPrice).toBe(12345);
      expect((analyzer as any).dates.start).toBe(5000);
    });

    it('should warn if benchmark candle is missing', () => {
      const bucket = new Map() as CandleBucket;

      analyzer.onStrategyWarmupCompleted([bucket]);

      expect(warning).toHaveBeenCalledWith('portfolio analyzer', expect.stringContaining('Missing benchmark candle'));
      expect((analyzer as any).startBenchmarkPrice).toBe(0);
    });
  });
});
