import { EQUITY_SNAPSHOT_EVENT, PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { CandleBucket } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import { createEmptyPortfolio, updateAssetBalance } from '@utils/portfolio/portfolio.utils';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { PortfolioAnalyzer } from './portfolioAnalyzer';
import { EMPTY_PORTFOLIO_REPORT } from './portfolioAnalyzer.const';
import { logPortfolioReport } from './portfolioAnalyzer.utils';

// Mock dependencies
vi.mock('./portfolioAnalyzer.utils', () => ({
  logPortfolioReport: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
    getStrategy: vi.fn(),
  },
}));

vi.mock('@services/logger', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));

describe('PortfolioAnalyzer', () => {
  let analyzer: PortfolioAnalyzer;
  let emitSpy: MockInstance;
  let deferredEmitSpy: MockInstance;

  beforeEach(() => {
    vi.mocked(config.getWatch).mockReturnValue({
      assets: ['BTC', 'ETH'],
      currency: 'USDT',
      timeframe: '1m',
      mode: 'backtest',
      warmup: { candleCount: 0 },
      pairs: [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }],
    } as any);

    analyzer = new PortfolioAnalyzer({ enableConsoleTable: false, name: 'PortfolioAnalyzer', riskFreeReturn: 5 });

    // Performance report uses `emit`, Equity Snapshot uses `addDeferredEmit`
    emitSpy = vi.spyOn(analyzer as any, 'emit').mockImplementation(() => {});
    deferredEmitSpy = vi.spyOn(analyzer as any, 'addDeferredEmit').mockImplementation(() => {});
  });

  describe('Configuration', () => {
    it.each`
      property                | expected
      ${'riskFreeReturn'}     | ${5}
      ${'enableConsoleTable'} | ${false}
      ${'benchmarkAsset'}     | ${'SOL'}
    `('should use default config values and fallback - $property = $expected', ({ property, expected }) => {
      vi.mocked(config.getWatch).mockReturnValue({
        assets: ['SOL', 'ETH'],
        currency: 'USDT',
        timeframe: '1m',
        mode: 'backtest',
        warmup: { candleCount: 0 },
        pairs: [{ symbol: 'SOL/USDT' }, { symbol: 'ETH/USDT' }],
      } as any);

      const analyzerObj = new PortfolioAnalyzer({ name: 'PortfolioAnalyzer' } as any);
      expect((analyzerObj as any)[property]).toBe(expected);
    });
  });

  describe('MTM Valuation', () => {
    it.each`
      btcAmount | ethAmount | usdtAmount | expectedEquity
      ${1}      | ${2}      | ${10000}   | ${66000}
      ${0}      | ${0}      | ${1000}    | ${1000}
    `('should calculate startEquity correctly ($expectedEquity)', ({ btcAmount, ethAmount, usdtAmount, expectedEquity }) => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT' as any, { start: 1000, open: 50000, high: 50000, low: 50000, close: 50000, volume: 1 } as any);
      bucket.set('ETH/USDT' as any, { start: 1000, open: 3000, high: 3000, low: 3000, close: 3000, volume: 1 } as any);

      (analyzer as any).processOneMinuteBucket(bucket);

      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'BTC', { total: btcAmount, free: btcAmount, used: 0 });
      updateAssetBalance(portfolio, 'ETH', { total: ethAmount, free: ethAmount, used: 0 });
      updateAssetBalance(portfolio, 'USDT', { total: usdtAmount, free: usdtAmount, used: 0 });

      analyzer.onPortfolioChange([portfolio]);

      expect((analyzer as any).startEquity).toBe(expectedEquity);
    });

    it.each`
      btcAmount | ethAmount | usdtAmount | expectedEquity
      ${1}      | ${2}      | ${10000}   | ${66000}
      ${0}      | ${0}      | ${1000}    | ${1000}
    `('should append to equity curve after warmup ($expectedEquity)', ({ btcAmount, ethAmount, usdtAmount, expectedEquity }) => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT' as any, { start: 1000, open: 50000, high: 50000, low: 50000, close: 50000, volume: 1 } as any);
      bucket.set('ETH/USDT' as any, { start: 1000, open: 3000, high: 3000, low: 3000, close: 3000, volume: 1 } as any);

      (analyzer as any).processOneMinuteBucket(bucket);

      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'BTC', { total: btcAmount, free: btcAmount, used: 0 });
      updateAssetBalance(portfolio, 'ETH', { total: ethAmount, free: ethAmount, used: 0 });
      updateAssetBalance(portfolio, 'USDT', { total: usdtAmount, free: usdtAmount, used: 0 });

      (analyzer as any).warmupCompleted = true;
      analyzer.onPortfolioChange([portfolio]);

      const curve = (analyzer as any).equityCurve;
      expect(curve[curve.length - 1].totalValue).toBe(expectedEquity);
    });

    it('should skip valuation if prices are missing (startEquity)', () => {
      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'BTC', { total: 1, free: 1, used: 0 });
      analyzer.onPortfolioChange([portfolio]);
      expect((analyzer as any).startEquity).toBeNull();
    });

    it('should not update equityCurve if prices are missing', () => {
      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'BTC', { total: 1, free: 1, used: 0 });
      analyzer.onPortfolioChange([portfolio]);
      expect((analyzer as any).equityCurve.length).toBe(0);
    });
  });

  describe('Reporting', () => {
    it('should emit empty report if insufficient data', () => {
      (analyzer as any).processFinalize();
      expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, EMPTY_PORTFOLIO_REPORT);
    });

    it('should log warning if insufficient data', () => {
      (analyzer as any).processFinalize();
      expect(warning).toHaveBeenCalledWith('portfolio analyzer', expect.stringContaining('Insufficient data'));
    });

    it('should use console table log if enabled', () => {
      const tableAnalyzer = new PortfolioAnalyzer({ enableConsoleTable: true, name: 'PortfolioAnalyzer', riskFreeReturn: 5 });
      (tableAnalyzer as any).processFinalize();
      expect(logPortfolioReport).toHaveBeenCalled();
    });

    it('should handle zero elapsed years and zero volatility with one snapshot (volatility check)', () => {
      (analyzer as any).startEquity = 1000;
      (analyzer as any).dates.start = 1000;
      (analyzer as any).dates.end = 1000;
      (analyzer as any).recordSnapshot(1000, 1000);

      const report = (analyzer as any).calculateReportStatistics();
      expect(report.volatility).toBe(0);
    });

    it('should handle zero elapsed years and zero volatility with one snapshot (profit check)', () => {
      (analyzer as any).startEquity = 1000;
      (analyzer as any).dates.start = 1000;
      (analyzer as any).dates.end = 1000;
      (analyzer as any).recordSnapshot(1000, 1000);

      const report = (analyzer as any).calculateReportStatistics();
      expect(report.annualizedNetProfit).toBe(0);
    });

    describe('Metrics calculation on Finalize', () => {
      beforeEach(() => {
        // Warmup
        const bucket1 = new Map() as CandleBucket;
        bucket1.set('BTC/USDT', { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
        bucket1.set('ETH/USDT', { start: 1000, open: 10, high: 10, low: 10, close: 10, volume: 1 });
        (analyzer as any).onStrategyWarmupCompleted([bucket1]);
        (analyzer as any).processOneMinuteBucket(bucket1);

        // Initial Portfolio
        const p1: Portfolio = createEmptyPortfolio();
        updateAssetBalance(p1, 'USDT', { total: 1000, free: 1000, used: 0 });
        analyzer.onPortfolioChange([p1]);

        // 1 Year Pass
        const bucket2 = new Map() as CandleBucket;
        const oneYearLater = 1000 + 31536000000;
        bucket2.set('BTC/USDT', { start: oneYearLater, open: 110, high: 110, low: 110, close: 110, volume: 1 });
        bucket2.set('ETH/USDT', { start: oneYearLater, open: 10, high: 10, low: 10, close: 10, volume: 1 });
        (analyzer as any).processOneMinuteBucket(bucket2);

        const p2: Portfolio = createEmptyPortfolio();
        updateAssetBalance(p2, 'BTC', { total: 5, free: 5, used: 0 });
        updateAssetBalance(p2, 'USDT', { total: 450, free: 450, used: 0 });
        analyzer.onPortfolioChange([p2]);

        // 2 Years Pass
        const twoYearsLater = oneYearLater + 31536000000;
        const bucket3 = new Map() as CandleBucket;
        bucket3.set('BTC/USDT', { start: twoYearsLater, open: 200, high: 200, low: 200, close: 200, volume: 1 });
        bucket3.set('ETH/USDT', { start: twoYearsLater, open: 10, high: 10, low: 10, close: 10, volume: 1 });
        (analyzer as any).processOneMinuteBucket(bucket3);
        analyzer.onPortfolioChange([p2]); // Equity = 1450

        // Finalize
        (analyzer as any).processFinalize();
      });

      it('should emit report containing correct netProfit', () => {
        expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, expect.objectContaining({ netProfit: 450 }));
      });

      it('should emit report containing correct totalReturnPct', () => {
        expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, expect.objectContaining({ totalReturnPct: 45 }));
      });

      it('should emit report containing correct benchmarkAsset', () => {
        expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, expect.objectContaining({ benchmarkAsset: 'BTC' }));
      });
    });

    it('should handle benchmark return calculation with missing data (0 startPrice)', () => {
      (analyzer as any).startEquity = 1000;
      (analyzer as any).recordSnapshot(1000, 1100);
      (analyzer as any).recordSnapshot(2000, 1100);

      (analyzer as any).startBenchmarkPrice = 0;
      (analyzer as any).endBenchmarkPrice = 100;

      const report = (analyzer as any).calculateReportStatistics();
      expect(report.marketReturnPct).toBe(0);
    });
  });

  describe('Events', () => {
    it('should emit equitySnapshot on order completed via deferred', () => {
      analyzer['warmupCompleted'] = true;
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT', { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
      bucket.set('ETH/USDT', { start: 1000, open: 10, high: 10, low: 10, close: 10, volume: 1 });
      (analyzer as any).processOneMinuteBucket(bucket);

      const portfolio: Portfolio = createEmptyPortfolio();
      updateAssetBalance(portfolio, 'USDT', { total: 1000, free: 1000, used: 0 });

      analyzer.onOrderCompleted([
        {
          order: { orderExecutionDate: 123456789 } as any,
          exchange: { portfolio } as any,
        },
      ]);

      expect(deferredEmitSpy).toHaveBeenCalledWith(EQUITY_SNAPSHOT_EVENT, { date: 123456789, totalValue: 1000 });
    });

    it('should not emit snapshot if warmup not completed', () => {
      analyzer['warmupCompleted'] = false;
      const portfolio: Portfolio = createEmptyPortfolio();
      analyzer.onOrderCompleted([{ order: { orderExecutionDate: 123456789 } as any, exchange: { portfolio } as any }]);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });

    it('should not emit snapshot if missing prices on order completed', () => {
      analyzer['warmupCompleted'] = true;
      const portfolio: Portfolio = createEmptyPortfolio();
      analyzer.onOrderCompleted([{ order: { orderExecutionDate: 123456789 } as any, exchange: { portfolio } as any }]);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Warmup', () => {
    it.each`
      property                 | expected
      ${'warmupCompleted'}     | ${true}
      ${'startBenchmarkPrice'} | ${12345}
    `('should set properties on warmup completed ($property -> $expected)', ({ property, expected }) => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT', { start: 5000, open: 100, high: 100, low: 100, close: 12345, volume: 1 });

      analyzer.onStrategyWarmupCompleted([bucket]);
      expect((analyzer as any)[property]).toBe(expected);
    });

    it('should set start date on warmup completed', () => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT', { start: 5000, open: 100, high: 100, low: 100, close: 12345, volume: 1 });

      analyzer.onStrategyWarmupCompleted([bucket]);
      expect((analyzer as any).dates.start).toBe(5000);
    });

    it('should warn if benchmark candle is missing', () => {
      const bucket = new Map() as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(warning).toHaveBeenCalledWith('portfolio analyzer', expect.stringContaining('Missing benchmark candle'));
    });

    it('should warn if timeframe bucket is missing', () => {
      analyzer.onStrategyWarmupCompleted([]);
      expect(warning).toHaveBeenCalledWith('portfolio analyzer', expect.stringContaining('Missing timeframe bucket'));
    });

    it('should leave startBenchmarkPrice as 0 if missing benchmark candle', () => {
      const bucket = new Map() as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect((analyzer as any).startBenchmarkPrice).toBe(0);
    });
  });

  describe('Process Bucket', () => {
    it('should throw error if missing candle in bucket', () => {
      const bucket = new Map() as CandleBucket;
      expect(() => {
        (analyzer as any).processOneMinuteBucket(bucket);
      }).toThrowError('Impossible to get first candle from bucket');
    });

    it('should ignore asset with missing candle in bucket', () => {
      const bucket = new Map() as CandleBucket;
      bucket.set('DOGE/USDT' as any, { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
      (analyzer as any).processOneMinuteBucket(bucket);
      expect((analyzer as any).latestPrices.size).toBe(0);
    });

    it('should not update end date if warmup is not completed', () => {
      const bucket = new Map() as CandleBucket;
      bucket.set('BTC/USDT' as any, { start: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
      (analyzer as any).warmupCompleted = false;
      (analyzer as any).dates.end = 0;
      (analyzer as any).processOneMinuteBucket(bucket);
      expect((analyzer as any).dates.end).toBe(0);
    });
  });

  describe('Process Init', () => {
    it('should be a noop when processInit is called', () => {
      expect(() => (analyzer as any).processInit()).not.toThrow();
    });
  });

  describe('Static Configuration', () => {
    it('should configure runtime modes', () => {
      const config = PortfolioAnalyzer.getStaticConfiguration();
      expect(config.modes).toEqual(['realtime', 'backtest']);
    });

    it('should declare correct event handlers', () => {
      const config = PortfolioAnalyzer.getStaticConfiguration();
      expect(config.eventsHandlers).toEqual(expect.arrayContaining(['onPortfolioChange', 'onOrderCompleted', 'onStrategyWarmupCompleted']));
    });

    it('should declare emitted events', () => {
      const config = PortfolioAnalyzer.getStaticConfiguration();
      expect(config.eventsEmitted).toEqual(expect.arrayContaining([PERFORMANCE_REPORT_EVENT, EQUITY_SNAPSHOT_EVENT]));
    });
  });
});
