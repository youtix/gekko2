import { Report } from '@plugins/performanceAnalyser/performanceAnalyzer.types';
import { Plugin } from '@plugins/plugin';
import { error } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import Big from 'big.js';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { performanceReporterSchema } from './performanceReporter.schema';
import { PerformanceReporterConfig } from './performanceReporter.types';
import { generateStrategyId } from './performanceReporter.utils';

export class PerformanceReporter extends Plugin {
  private readonly formater: Intl.NumberFormat;
  private readonly filePath: string;
  private readonly header =
    'id;pair;start time;end time;duration;exposure;start price;end price;market;alpha;yearly profit;total trades;original balance;current balance;sharpe ratio;expected downside;ratio roundtrip;worst mae\n';

  constructor({ name, filePath, fileName }: PerformanceReporterConfig) {
    super(name);
    this.filePath = path.join(filePath, fileName);
    this.formater = new Intl.NumberFormat();
  }

  public onPerformanceReport(report: Report) {
    const csvLine =
      [
        generateStrategyId(this.strategySettings),
        `${this.asset}/${this.currency}`,
        toISOString(report.startTime),
        toISOString(report.endTime),
        report.duration,
        `${+Big(report.exposure).round(2, Big.roundHalfEven)}%`,
        `${this.formater.format(report.startPrice)} ${this.currency}`,
        `${this.formater.format(report.endPrice)} ${this.currency}`,
        `${+Big(report.market).round(2, Big.roundDown)}%`,
        `${+Big(report.alpha).round(2, Big.roundDown)}%`,
        `${this.formater.format(report.yearlyProfit)} ${this.currency} (${+Big(report.relativeYearlyProfit).round(2, Big.roundDown)}%)`,
        report.trades,
        `${this.formater.format(report.startBalance)} ${this.currency}`,
        `${this.formater.format(report.balance)} ${this.currency}`,
        report.sharpe,
        `${+Big(report.downside).round(2, Big.roundDown)}%`,
        `${+Big(report.ratioRoundTrips).round(2, Big.roundDown)}%`,
        `${this.formater.format(report.worstMaxAdverseExcursion)} ${this.currency}`,
      ].join(';') + '\n';

    try {
      // Acquire an exclusive lock, append, then release.
      const release = this.getFs().lockSync(this.filePath, { retries: 5 });
      try {
        appendFileSync(this.filePath, csvLine, 'utf8');
      } finally {
        release();
      }
    } catch (err) {
      error('performance reporter', `write error: ${err}`);
    }
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    try {
      // Create parent folders if the user supplied a nested path
      mkdirSync(path.dirname(this.filePath), { recursive: true });

      // Guard header creation with a lock so only the first process writes it
      const needsHeader = !existsSync(this.filePath) || statSync(this.filePath).size === 0;
      if (needsHeader) {
        const release = this.getFs().lockSync(this.filePath, { retries: 3 });
        try {
          if (!existsSync(this.filePath) || statSync(this.filePath).size === 0) {
            writeFileSync(this.filePath, this.header, 'utf8');
          }
        } finally {
          release();
        }
      }
    } catch (err) {
      error('performance reporter', `setup error: ${err}`);
    }
  }

  protected processCandle(): void {
    /* noop */
  }
  protected processFinalize(): void {
    /* noop */
  }

  public static getStaticConfiguration() {
    return {
      schema: performanceReporterSchema,
      modes: ['backtest'],
      dependencies: [],
      inject: ['fs'],
      eventsHandlers: [...Object.getOwnPropertyNames(PerformanceReporter.prototype).filter(n => n.startsWith('on'))],
      eventsEmitted: [],
      name: 'PerformanceReporter',
    } as const;
  }
}
