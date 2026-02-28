import { Report } from '@models/event.types';
import { PortfolioReport } from '@plugins/analyzers/portfolioAnalyzer/portfolioAnalyzer.types';
import { TradingReport } from '@plugins/analyzers/roundTripAnalyzer/roundTrip.types';
import { Plugin } from '@plugins/plugin';
import { lockSync as defaultLockSync } from '@services/fs/fs.service';
import { Fs } from '@services/fs/fs.types';
import { error } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatRatio } from '@utils/string/string.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { performanceReporterSchema } from './performanceReporter.schema';
import { PerformanceReporterConfig } from './performanceReporter.types';
import { generateStrategyId } from './performanceReporter.utils';

export class PerformanceReporter extends Plugin {
  private readonly formater: Intl.NumberFormat;
  private readonly filePath: string;
  private fs: Fs = { lockSync: defaultLockSync };

  private readonly portfolioHeader =
    'id;pair;net profit;total return;yearly profit;market;alpha;sharpe ratio;sortino ratio;max drawdown;total changes;start time;end time;duration;exposure;original balance;current balance;start price;end price;standard deviation;downside deviation;longest drawdown duration;benchmark asset\n';

  private readonly tradingHeader =
    'id;pair;net profit;total return;annualized return;win rate;market;alpha;sharpe ratio;sortino ratio;trade count;start time;end time;duration;exposure;start balance;final balance;start price;end price;standard deviation;downside deviation;top maes\n';

  constructor({ name, filePath, fileName }: PerformanceReporterConfig) {
    super(name);
    // Use user provided fileName or default to performanceReporter.csv
    const actualFileName = fileName || 'performanceReporter.csv';
    this.filePath = path.join(filePath, actualFileName);
    this.formater = new Intl.NumberFormat();
  }

  public setFs(fs: Fs) {
    this.fs = fs;
  }

  // Here the payload is not an array because onPerformanceReport use emit function directly.
  // It is not using the sequentialEmitter because it is emitted in processFinalize() of plugin lifecycle hooks
  public onPerformanceReport(report: PortfolioReport | TradingReport) {
    // Check if we need to write a header (lazy initialization)
    this.ensureHeader(report);

    let csvLine = '';

    if (report.id === 'PORTFOLIO PROFIT REPORT') {
      csvLine = this.handlePortfolioReport(report);
    } else if (report.id === 'TRADING REPORT') {
      csvLine = this.handleTradingReport(report);
    }

    if (csvLine) {
      try {
        // Acquire an exclusive lock, append, then release.
        const release = this.fs.lockSync(this.filePath, { retries: 5 });
        try {
          appendFileSync(this.filePath, csvLine, 'utf8');
        } finally {
          release();
        }
      } catch (err) {
        error('performance reporter', `write error: ${err}`);
      }
    }
  }

  private ensureHeader(firstReport: Report) {
    try {
      const needsHeader = !existsSync(this.filePath) || statSync(this.filePath).size === 0;

      if (needsHeader) {
        const release = this.fs.lockSync(this.filePath, { retries: 3 });
        try {
          // Double-check inside lock
          if (!existsSync(this.filePath) || statSync(this.filePath).size === 0) {
            let headerToWrite = '';
            if (firstReport.id === 'PORTFOLIO PROFIT REPORT') {
              headerToWrite = this.portfolioHeader;
            } else if (firstReport.id === 'TRADING REPORT') {
              headerToWrite = this.tradingHeader;
            }

            if (headerToWrite) {
              writeFileSync(this.filePath, headerToWrite, 'utf8');
            }
          }
        } finally {
          release();
        }
      }
    } catch (err) {
      error('performance reporter', `header check error: ${err}`);
    }
  }

  private handlePortfolioReport(report: PortfolioReport): string {
    const formattedDrawdownDuration =
      report.longestDrawdownMs > 0 ? formatDuration(intervalToDuration({ start: 0, end: report.longestDrawdownMs })) : '0';

    return (
      [
        generateStrategyId(this.strategySettings),
        'Portfolio',
        `${this.formater.format(report.netProfit)}`,
        `${round(report.totalReturnPct, 2, 'down')}%`,
        `${this.formater.format(report.annualizedNetProfit)} (${round(report.annualizedReturnPct, 2, 'down')}%)`,
        `${round(report.marketReturnPct, 2, 'down')}%`,
        `${round(report.alpha, 2, 'down')}%`,
        formatRatio(report.sharpeRatio),
        formatRatio(report.sortinoRatio),
        `${round(report.maxDrawdownPct, 2, 'down')}%`,
        report.portfolioChangeCount,
        toISOString(report.periodStartAt),
        toISOString(report.periodEndAt),
        report.formattedDuration,
        `${round(report.exposurePct, 2, 'halfEven')}%`,
        `${this.formater.format(report.startEquity)}`,
        `${this.formater.format(report.endEquity)}`,
        `${this.formater.format(report.startPrice)}`,
        `${this.formater.format(report.endPrice)}`,
        formatRatio(report.volatility),
        formatRatio(report.downsideDeviation),
        formattedDrawdownDuration,
        report.benchmarkAsset,
      ].join(';') + '\n'
    );
  }

  private handleTradingReport(report: TradingReport): string {
    return (
      [
        generateStrategyId(this.strategySettings),
        'Trading',
        `${this.formater.format(report.netProfit)}`,
        `${round(report.totalReturnPct, 2, 'down')}%`,
        `${this.formater.format(report.annualizedNetProfit)} (${round(report.annualizedReturnPct, 2, 'down')}%)`,
        report.winRate !== null ? `${round(report.winRate, 2, 'halfEven')}%` : 'N/A',
        `${round(report.marketReturnPct, 2, 'down')}%`,
        `${round(report.alpha, 2, 'down')}%`,
        formatRatio(report.sharpeRatio),
        formatRatio(report.sortinoRatio),
        report.tradeCount,
        toISOString(report.periodStartAt),
        toISOString(report.periodEndAt),
        report.formattedDuration,
        `${round(report.exposurePct, 2, 'halfEven')}%`,
        `${this.formater.format(report.startBalance)}`,
        `${this.formater.format(report.finalBalance)}`,
        `${this.formater.format(report.startPrice)}`,
        `${this.formater.format(report.endPrice)}`,
        formatRatio(report.volatility),
        formatRatio(report.downsideDeviation),
        JSON.stringify(report.topMAEs),
      ].join(';') + '\n'
    );
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    try {
      // Create parent folders if the user supplied a nested path
      mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch (err) {
      error('performance reporter', `setup error: ${err}`);
    }
  }

  protected processOneMinuteBucket(): void {
    /* noop */
  }
  protected processFinalize(): void {
    /* noop */
  }

  public static getStaticConfiguration() {
    return {
      name: 'PerformanceReporter',
      schema: performanceReporterSchema,
      modes: ['backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: [...Object.getOwnPropertyNames(PerformanceReporter.prototype).filter(n => n.startsWith('on'))],
      eventsEmitted: [],
    } as const;
  }
}
