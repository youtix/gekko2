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
    reporter = new PerformanceReporter(baseConfig);
    reporter['setFs']({ lockSync: lockSyncMock });

    // Reset individual mocks instead of clearAllMocks() to adhere to rules
    (fs.mkdirSync as Mock).mockReset();
    (fs.existsSync as Mock).mockReset();
    (fs.writeFileSync as Mock).mockReset();
    (fs.appendFileSync as Mock).mockReset();
    (fs.statSync as Mock).mockReset();
    lockSyncMock.mockClear();
    releaseMock.mockClear();
  });

  describe('#processInit', () => {
    it('should create directories', async () => {
      await reporter['processInit']();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(path.join(baseConfig.filePath, baseConfig.fileName)), { recursive: true });
    });

    it('should handle errors during directory creation without throwing', async () => {
      const error = new Error('Permission denied');
      (fs.mkdirSync as Mock).mockImplementation(() => {
        throw error;
      });
      expect(() => reporter['processInit']()).not.toThrow();
    });

    it('should log errors during directory creation', async () => {
      const error = new Error('Permission denied');
      (fs.mkdirSync as Mock).mockImplementation(() => {
        throw error;
      });
      reporter['processInit']();
      const { error: logError } = await import('@services/logger');
      expect(logError).toHaveBeenCalledWith('performance reporter', `setup error: ${error}`);
    });
  });

  describe('#onPerformanceReport', () => {
    describe('When file is empty', () => {
      it.each`
        report                   | header
        ${samplePortfolioReport} | ${PORTFOLIO_HEADER}
        ${sampleTradingReport}   | ${TRADING_HEADER}
      `('should write header for $report.id', ({ report, header }) => {
        (fs.existsSync as Mock).mockReturnValue(false);
        (fs.statSync as Mock).mockReturnValue({ size: 0 });

        reporter.onPerformanceReport(report);

        const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);
        expect(fs.writeFileSync).toHaveBeenCalledWith(expectedPath, header, 'utf8');
      });

      it.each`
        report                   | expectedPart
        ${samplePortfolioReport} | ${'DEMA'}
        ${samplePortfolioReport} | ${'Portfolio'}
        ${samplePortfolioReport} | ${'3,650 (116.8%)'}
        ${sampleTradingReport}   | ${'DEMA'}
        ${sampleTradingReport}   | ${'Trading'}
        ${sampleTradingReport}   | ${'1,320'}
      `('should append correct parts ($expectedPart) for $report.id', ({ report, expectedPart }) => {
        (fs.existsSync as Mock).mockReturnValue(false);
        (fs.statSync as Mock).mockReturnValue({ size: 0 });

        reporter.onPerformanceReport(report);

        const appendCall = (fs.appendFileSync as Mock).mock.calls[0];
        const writtenLine = appendCall ? (appendCall[1] as string) : '';

        expect(writtenLine).toContain(expectedPart);
      });

      it.each`
        report
        ${samplePortfolioReport}
        ${sampleTradingReport}
      `('should release lock after writing $report.id', ({ report }) => {
        (fs.existsSync as Mock).mockReturnValue(false);
        (fs.statSync as Mock).mockReturnValue({ size: 0 });

        reporter.onPerformanceReport(report);

        expect(releaseMock).toHaveBeenCalled();
      });
    });

    describe('When file exists', () => {
      it('should not write header if file exists and has content', () => {
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });

        reporter.onPerformanceReport(samplePortfolioReport);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('should append report line if file exists and has content', () => {
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });

        reporter.onPerformanceReport(samplePortfolioReport);

        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
      });
    });

    describe('Edge Cases & Errors', () => {
      it('should ignore empty payloads or invalid objects (if passed as array by mistake handled at types or runtime)', () => {
        reporter.onPerformanceReport([] as any);
        expect(fs.appendFileSync).not.toHaveBeenCalled();
      });

      it('should not write header for empty payload', () => {
        reporter.onPerformanceReport([] as any);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it('should ignore unknown report types', () => {
        const unknownReport = { ...samplePortfolioReport, id: 'UNKNOWN' as any };
        reporter.onPerformanceReport(unknownReport);
        expect(fs.appendFileSync).not.toHaveBeenCalled();
      });

      it('should log write errors', async () => {
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });
        const error = new Error('Disk full');
        (fs.appendFileSync as Mock).mockImplementation(() => {
          throw error;
        });

        reporter.onPerformanceReport(samplePortfolioReport);

        const { error: logError } = await import('@services/logger');
        expect(logError).toHaveBeenCalledWith('performance reporter', `write error: ${error}`);
      });

      it('should release lock even on write error', () => {
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });
        const error = new Error('Disk full');
        (fs.appendFileSync as Mock).mockImplementation(() => {
          throw error;
        });

        reporter.onPerformanceReport(samplePortfolioReport);

        expect(releaseMock).toHaveBeenCalled();
      });

      it('should log header check errors', async () => {
        const error = new Error('Access denied');
        lockSyncMock.mockImplementation(() => {
          throw error;
        });

        reporter.onPerformanceReport(samplePortfolioReport);

        const { error: logError } = await import('@services/logger');
        expect(logError).toHaveBeenCalledWith('performance reporter', `header check error: ${error}`);
      });

      it('should format winRate as N/A when null', () => {
        const report = { ...sampleTradingReport, winRate: null as any };
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });

        reporter.onPerformanceReport(report);

        const appendCall = (fs.appendFileSync as Mock).mock.calls[0];
        const writtenLine = appendCall ? (appendCall[1] as string) : '';
        expect(writtenLine).toContain('N/A');
      });

      it('should handle zero drawdown correctly for portfolio', () => {
        const report = { ...samplePortfolioReport, longestDrawdownMs: 0 };
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ size: 100 });

        reporter.onPerformanceReport(report);

        const appendCall = (fs.appendFileSync as Mock).mock.calls[0];
        const writtenLine = appendCall ? (appendCall[1] as string) : '';
        expect(writtenLine).toContain(';0;');
      });
    });
  });

  describe('#processOneMinuteBucket', () => {
    it('should not throw', () => {
      expect(() => reporter['processOneMinuteBucket']()).not.toThrow();
    });
  });

  describe('#processFinalize', () => {
    it('should not throw', () => {
      expect(() => reporter['processFinalize']()).not.toThrow();
    });
  });

  describe('#getStaticConfiguration', () => {
    it('should return the expected static metadata config', () => {
      const meta = PerformanceReporter.getStaticConfiguration();
      expect(meta).toMatchObject({
        name: 'PerformanceReporter',
        modes: expect.arrayContaining(['backtest']),
      });
    });

    it('should have a schema', () => {
      const meta = PerformanceReporter.getStaticConfiguration();
      expect(meta.schema).toBeDefined();
    });
  });
});
