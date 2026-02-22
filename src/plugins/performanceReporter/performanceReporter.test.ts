import { PortfolioReport } from '@plugins/analyzers/portfolioAnalyzer/portfolioAnalyzer.types';
import { TradingReport } from '@plugins/analyzers/roundTripAnalyzer/roundTrip.types';
import * as fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { PerformanceReporter } from './performanceReporter';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('@services/logger', () => ({
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({
      pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
      warmup: {},
    })),
    getStrategy: vi.fn(() => ({ name: 'DEMA' })),
  },
}));

const PORTFOLIO_HEADER =
  'id;pair;net profit;total return;yearly profit;market;alpha;sharpe ratio;sortino ratio;max drawdown;total changes;start time;end time;duration;exposure;original balance;current balance;start price;end price;standard deviation;downside deviation;longest drawdown duration;benchmark asset\n';

const TRADING_HEADER =
  'id;pair;net profit;total return;annualized return;win rate;market;alpha;sharpe ratio;sortino ratio;trade count;start time;end time;duration;exposure;start balance;final balance;start price;end price;standard deviation;downside deviation;top maes\n';

const baseConfig = {
  name: 'PerformanceReporter',
  filePath: '/tmp',
  fileName: 'performanceReporter.csv',
};

const commonReportProps = {
  periodStartAt: 1748563200000,
  periodEndAt: 1748649600000,
  formattedDuration: '1 day',
  exposurePct: 0.5,
  marketReturnPct: 0.01,
  alpha: 0.12,
  annualizedNetProfit: 3650,
  annualizedReturnPct: 116.8,
  sharpeRatio: 1.25,
  sortinoRatio: 1.1,
  volatility: 2.5,
  startPrice: 100,
  endPrice: 110,
  netProfit: 100,
  totalReturnPct: 10,
  downsideDeviation: 0.5,
};

const samplePortfolioReport: PortfolioReport = {
  ...commonReportProps,
  id: 'PORTFOLIO PROFIT REPORT',
  equityCurve: [],
  maxDrawdownPct: 0.08,
  longestDrawdownMs: 9000000,
  startEquity: 1000,
  endEquity: 1320,
  portfolioChangeCount: 4,
  benchmarkAsset: 'USDT',
};

const sampleTradingReport: TradingReport = {
  ...commonReportProps,
  id: 'TRADING REPORT',
  finalBalance: 1320,
  startBalance: 1000,
  winRate: 60,
  topMAEs: [],
  tradeCount: 10,
};

describe('PerformanceReporter', () => {
  const releaseMock = vi.fn();
  const lockSyncMock = vi.fn(() => releaseMock);
  let reporter: PerformanceReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new PerformanceReporter(baseConfig);
    reporter['setFs']({ lockSync: lockSyncMock });
  });

  describe('#processInit', () => {
    it('should create directories', async () => {
      await reporter['processInit']();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(path.join(baseConfig.filePath, baseConfig.fileName)), { recursive: true });
    });

    it('should handle errors during directory creation', async () => {
      const error = new Error('Permission denied');
      (fs.mkdirSync as Mock).mockImplementation(() => {
        throw error;
      });

      expect(() => reporter['processInit']()).not.toThrow();
      const { error: logError } = await import('@services/logger');
      expect(logError).toHaveBeenCalledWith('performance reporter', `setup error: ${error}`);
    });
  });

  describe('#onPerformanceReport', () => {
    const successTestCases = [
      {
        description: 'Portfolio Report',
        report: samplePortfolioReport,
        header: PORTFOLIO_HEADER,
        expectedLineParts: [
          'DEMA',
          'Portfolio',
          '2025-05-30',
          '1 day',
          '0.5%',
          '100',
          '110',
          '3,650 (116.8%)',
          '2 hours 30 minutes',
          'USDT',
          '0.5',
          '100',
          '10%',
        ],
      },
      {
        description: 'Trading Report',
        report: sampleTradingReport,
        header: TRADING_HEADER,
        expectedLineParts: [
          'DEMA',
          'Trading',
          '2025-05-30',
          '1 day',
          '0.5%',
          '1,000',
          '1,320',
          '3,650 (116.8%)',
          '60%',
          '0.5',
          '100',
          '10%',
          '2.5',
          '100',
          '110',
        ],
      },
    ];

    it.each(successTestCases)('should write $description correctly when file is empty', ({ report, header, expectedLineParts }) => {
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.statSync as Mock).mockReturnValue({ size: 0 });

      reporter.onPerformanceReport([report]);

      const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);
      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedPath, header, 'utf8');

      const appendCall = (fs.appendFileSync as Mock).mock.calls[0];
      const writtenLine = appendCall[1] as string;

      expectedLineParts.forEach(part => {
        expect(writtenLine).toContain(part);
      });

      expect(fs.appendFileSync).toHaveBeenCalledWith(expectedPath, expect.any(String), 'utf8');
      expect(releaseMock).toHaveBeenCalled();
    });

    it('should append report without header if file exists', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 100 });

      reporter.onPerformanceReport([samplePortfolioReport]);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    it('should ignore empty payloads', () => {
      reporter.onPerformanceReport([]);
      expect(fs.appendFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should ignore unknown report types', () => {
      const unknownReport = { ...samplePortfolioReport, id: 'UNKNOWN' as any };
      reporter.onPerformanceReport([unknownReport]);
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should handle errors during file write', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 100 });
      const error = new Error('Disk full');
      (fs.appendFileSync as Mock).mockImplementation(() => {
        throw error;
      });

      reporter.onPerformanceReport([samplePortfolioReport]);

      const { error: logError } = await import('@services/logger');
      expect(logError).toHaveBeenCalledWith('performance reporter', `write error: ${error}`);
      expect(releaseMock).toHaveBeenCalled();
    });

    it('should handle errors during header check', async () => {
      const error = new Error('Access denied');
      lockSyncMock.mockImplementation(() => {
        throw error;
      });

      // We need to suppress the expected error in the error handler test for clarity or just check it was logged
      // But here ensureHeader catches it inside
      reporter.onPerformanceReport([samplePortfolioReport]);

      const { error: logError } = await import('@services/logger');
      expect(logError).toHaveBeenCalledWith('performance reporter', `header check error: ${error}`);
    });
  });

  describe('Formatting Edge Cases', () => {
    it('should format winRate as N/A when null', () => {
      const report = { ...sampleTradingReport, winRate: null as any };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 100 });

      reporter.onPerformanceReport([report]);

      const appendCall = (fs.appendFileSync as Mock).mock.calls[0];
      const writtenLine = appendCall[1] as string;
      expect(writtenLine).toContain('N/A');
    });
  });

  describe('#getStaticConfiguration', () => {
    it('should return the expected static metadata', () => {
      const meta = PerformanceReporter.getStaticConfiguration();

      expect(meta).toMatchObject({
        name: 'PerformanceReporter',
        modes: expect.arrayContaining(['backtest']),
      });
      expect(meta.schema).toBeDefined();
    });
  });
});
