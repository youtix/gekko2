import { PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { Candle } from '@models/candle.types';
import { OrderCompleted } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { warning } from '@services/logger';
import { percentile, stdev } from '@utils/math/math.utils';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { filter } from 'lodash-es';
import { Plugin } from '../plugin';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';
import { DateRange, PerformanceAnalyzerConfig, Report, Start } from './performanceAnalyzer.types';
import { logFinalize } from './performanceAnalyzer.utils';

const YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export class PerformanceAnalyzer extends Plugin {
  private balance: number;
  private dates: DateRange;
  private endPrice: number;
  private exposure: number;
  private exposureActiveSince: number | null;
  private riskFreeReturn: number;
  private start: Start;
  private latestPortfolio: Portfolio | null;
  private startPrice: number;
  private orders: number;
  private warmupCandle?: Candle;
  private warmupCompleted: boolean;
  private enableConsoleTable: boolean;
  private balanceSamples: { date: number; balance: number }[];

  constructor({ riskFreeReturn, enableConsoleTable }: PerformanceAnalyzerConfig) {
    super(PerformanceAnalyzer.name);

    this.balance = 0;
    this.dates = { start: 0, end: 0 };
    this.endPrice = 0;
    this.exposure = 0;
    this.exposureActiveSince = null;
    this.riskFreeReturn = riskFreeReturn ?? 1;
    this.start = { balance: 0, portfolio: null };
    this.latestPortfolio = null;
    this.startPrice = 0;
    this.orders = 0;
    this.warmupCompleted = false;
    this.enableConsoleTable = enableConsoleTable ?? false;
    this.balanceSamples = [];
  }

  // --- BEGIN LISTENERS ---
  public onPortfolioValueChange(event: { balance: number }): void {
    if (!this.start.balance) this.start.balance = event.balance;
    this.balance = event.balance;
  }

  public onPortfolioChange(event: Portfolio): void {
    if (!this.start.portfolio) this.start.portfolio = event;
    this.latestPortfolio = event;
  }

  public onStrategyWarmupCompleted({ start, close }: Candle): void {
    this.warmupCompleted = true;
    this.dates.start = start;
    this.startPrice = close;
    const portfolio = this.latestPortfolio ?? this.start.portfolio;
    if (portfolio?.asset && portfolio.asset > 0 && this.exposureActiveSince === null) {
      this.exposureActiveSince = this.dates.start;
    }
    if (this.warmupCandle) this.processOneMinuteCandle(this.warmupCandle);
  }

  public onOrderCompleted(trade: OrderCompleted): void {
    this.orders++;
    this.balance = trade.balance;
    this.latestPortfolio = trade.portfolio;
    this.balanceSamples.push({ date: trade.date, balance: trade.balance });

    const isCurrentlyExposed = this.exposureActiveSince !== null;
    const isExposedAfterTrade = trade.portfolio.asset > 0;

    if (!isCurrentlyExposed && isExposedAfterTrade) {
      this.exposureActiveSince = trade.date;
    }

    if (isCurrentlyExposed && !isExposedAfterTrade && this.exposureActiveSince !== null) {
      this.exposure += Math.max(0, trade.date - this.exposureActiveSince);
      this.exposureActiveSince = null;
    }
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---

  private calculateReportStatistics() {
    if (!this.start.balance || !this.start.portfolio)
      return warning(
        'performance analyzer',
        'Cannot calculate a profit report without having received portfolio data. Skipping performanceReport..',
      );

    const portfolio = this.latestPortfolio ?? this.start.portfolio;
    if (portfolio && this.endPrice > 0) {
      const markToMarketBalance = portfolio.asset * this.endPrice + portfolio.currency;
      if (Number.isFinite(markToMarketBalance)) this.balance = markToMarketBalance;
    }

    const profit = this.balance - this.start.balance;

    const timespan = intervalToDuration({
      start: this.dates.start,
      end: this.dates.end,
    });
    const elapsedMs = differenceInMilliseconds(this.dates.end, this.dates.start);
    const elapsedYears = elapsedMs / YEAR_MS;
    const relativeProfit = (this.balance / this.start.balance) * 100 - 100;
    const relativeYearlyProfit = relativeProfit / (elapsedYears || 1);

    const percentExposure = elapsedMs > 0 ? (this.exposure / elapsedMs) * 100 : 0;

    const orderedSamples = [...this.balanceSamples].sort((left, right) => left.date - right.date);
    const returns: number[] = [];
    let previousBalance = this.start.balance;
    for (const sample of orderedSamples) {
      if (!previousBalance) break;
      const change = (sample.balance / previousBalance - 1) * 100;
      if (Number.isFinite(change)) returns.push(change);
      previousBalance = sample.balance;
    }

    const volatility = stdev(returns);
    const standardDeviation = Number.isNaN(volatility) ? 0 : volatility;
    const sharpe = !standardDeviation ? 0 : (relativeYearlyProfit - this.riskFreeReturn) / standardDeviation;

    const lossReturns = returns.filter(r => r < 0);
    const observations = returns.length;
    const adjustedCount = observations > 2 ? observations - 2 : 1;
    const downside =
      lossReturns.length > 0 ? Math.sqrt((observations || 1) / adjustedCount) * percentile(lossReturns, 0.25) : 0;
    const downsideDeviation = lossReturns.length ? stdev(lossReturns) : 0;
    const sortino = !downsideDeviation ? 0 : (relativeYearlyProfit - this.riskFreeReturn) / Math.abs(downsideDeviation);

    const market = this.startPrice ? ((this.endPrice - this.startPrice) / this.startPrice) * 100 : 0;

    const report: Report = {
      alpha: relativeProfit - market,
      balance: this.balance,
      downside,
      endPrice: this.endPrice,
      endTime: this.dates.end,
      exposure: percentExposure,
      market,
      profit,
      relativeProfit,
      relativeYearlyProfit,
      sharpe,
      sortino,
      standardDeviation,
      startBalance: this.start.balance,
      startPrice: this.startPrice,
      startTime: this.dates.start,
      duration: formatDuration(timespan),
      orders: this.orders,
      yearlyProfit: profit / (elapsedYears || 1),
    };

    return report;
  }
  // --- END INTERNALS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processOneMinuteCandle(candle: Candle): void {
    if (this.warmupCompleted) {
      this.dates.end = addMinutes(candle.start, 1).getTime();
      this.endPrice = candle.close;
    } else {
      this.warmupCandle = candle;
    }
  }

  protected processFinalize(): void {
    if (this.exposureActiveSince !== null) {
      const finalBoundary = this.dates.end > 0 ? this.dates.end : this.exposureActiveSince;
      if (finalBoundary !== undefined && finalBoundary !== null) {
        this.exposure += Math.max(0, finalBoundary - this.exposureActiveSince);
      }
      this.exposureActiveSince = null;
    }

    const report = this.calculateReportStatistics();
    if (report) {
      logFinalize(report, this.currency, this.enableConsoleTable);
      this.emit(PERFORMANCE_REPORT_EVENT, report);
    }
  }

  public static getStaticConfiguration() {
    return {
      schema: performanceAnalyzerSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(PerformanceAnalyzer.prototype), p => p.startsWith('on')),
      eventsEmitted: [PERFORMANCE_REPORT_EVENT],
      name: 'PerformanceAnalyzer',
    };
  }
}
