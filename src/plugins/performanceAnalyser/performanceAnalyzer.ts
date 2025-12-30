import { PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { Candle } from '@models/candle.types';
import { BalanceSnapshot, OrderCompletedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { warning } from '@services/logger';
import { longestDrawdownDuration, maxDrawdown, sharpeRatio, sortinoRatio, stdev } from '@utils/math/math.utils';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { filter } from 'lodash-es';
import { Plugin } from '../plugin';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';
import { DateRange, PerformanceAnalyzerConfig, Report, Start } from './performanceAnalyzer.types';
import { logFinalize, logTrade } from './performanceAnalyzer.utils';

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
  private tradeBalanceSamples: BalanceSnapshot[]; // For returns/volatility
  private priceBalanceSamples: BalanceSnapshot[]; // For drawdown metrics

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
    this.tradeBalanceSamples = [];
    this.priceBalanceSamples = [];
  }

  // --- BEGIN LISTENERS ---
  public onPortfolioValueChange(payloads: BalanceSnapshot[]): void {
    // Latest strategy: only process the most recent payload
    const event = payloads[payloads.length - 1];
    if (!this.start.balance) this.start.balance = event.balance.total;
    this.balance = event.balance.total;

    // Record sample for accurate drawdown tracking
    if (this.warmupCompleted && this.dates.end > 0) {
      this.priceBalanceSamples.push({ date: this.dates.end, balance: event.balance });
    }
  }

  public onPortfolioChange(payloads: Portfolio[]): void {
    // Latest strategy: only process the most recent payload
    const event = payloads[payloads.length - 1];
    if (!this.start.portfolio) this.start.portfolio = event;
    this.latestPortfolio = event;
  }

  public onStrategyWarmupCompleted([{ start, close }]: [Candle]): void {
    // There is only one warmup event during the execution so always one payload
    this.warmupCompleted = true;
    this.dates.start = start;
    this.startPrice = close;
    const portfolio = this.latestPortfolio ?? this.start.portfolio;
    if (portfolio?.asset && portfolio.asset.total > 0 && this.exposureActiveSince === null) {
      this.exposureActiveSince = this.dates.start;
    }
    if (this.warmupCandle) this.processOneMinuteCandle(this.warmupCandle);
  }

  public onOrderCompleted(payloads: OrderCompletedEvent[]): void {
    // Sequential strategy: process each payload in order
    for (const { order, exchange } of payloads) {
      this.orders++;
      this.balance = exchange.balance.total;
      this.latestPortfolio = exchange.portfolio;
      const lastSample = this.tradeBalanceSamples[this.tradeBalanceSamples.length - 1];

      logTrade(order, exchange, this.currency, this.asset, this.enableConsoleTable, {
        startBalance: this.start.balance || exchange.balance.total,
        previousBalance: lastSample?.balance.total,
      });

      this.tradeBalanceSamples.push({ date: order.orderExecutionDate, balance: exchange.balance });

      const isCurrentlyExposed = this.exposureActiveSince !== null;
      const isExposedAfterTrade = exchange.portfolio.asset.total > 0;

      if (!isCurrentlyExposed && isExposedAfterTrade) {
        this.exposureActiveSince = order.orderExecutionDate;
      }

      if (isCurrentlyExposed && !isExposedAfterTrade && this.exposureActiveSince !== null) {
        this.exposure += Math.max(0, order.orderExecutionDate - this.exposureActiveSince);
        this.exposureActiveSince = null;
      }
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
      const markToMarketBalance = portfolio.asset.total * this.endPrice + portfolio.currency.total;
      if (Number.isFinite(markToMarketBalance)) this.balance = markToMarketBalance;
    }

    const profit = this.balance - this.start.balance;
    const timespan = intervalToDuration({ start: this.dates.start, end: this.dates.end });
    const elapsedMs = differenceInMilliseconds(this.dates.end, this.dates.start);
    const elapsedYears = elapsedMs / YEAR_MS;
    const relativeProfit = (this.balance / this.start.balance) * 100 - 100;
    const relativeYearlyProfit = relativeProfit / (elapsedYears || 1);
    const percentExposure = elapsedMs > 0 ? (this.exposure / elapsedMs) * 100 : 0;
    const orderedSamples = [...this.tradeBalanceSamples].sort((left, right) => left.date - right.date);
    const returns: number[] = [];
    let previousBalance = this.start.balance;
    for (const sample of orderedSamples) {
      if (!previousBalance) break;
      const change = (sample.balance.total / previousBalance - 1) * 100;
      if (Number.isFinite(change)) returns.push(change);
      previousBalance = sample.balance.total;
    }

    const market = this.startPrice ? ((this.endPrice - this.startPrice) / this.startPrice) * 100 : 0;
    const ratioParams = {
      returns,
      yearlyProfit: relativeYearlyProfit,
      riskFreeReturn: this.riskFreeReturn,
      elapsedYears,
    };

    const balancesOnly = this.priceBalanceSamples.map(s => s.balance.total);
    const lddMs = longestDrawdownDuration(this.priceBalanceSamples, this.start.balance);
    const lddFormatted = lddMs > 0 ? formatDuration(intervalToDuration({ start: 0, end: lddMs })) : '0';

    const report: Report = {
      alpha: relativeProfit - market,
      balance: this.balance,
      maxDrawdown: maxDrawdown(balancesOnly, this.start.balance),
      longestDrawdownDuration: lddFormatted,
      endPrice: this.endPrice,
      endTime: this.dates.end,
      exposure: percentExposure,
      market,
      profit,
      relativeProfit,
      relativeYearlyProfit,
      sharpe: sharpeRatio(ratioParams),
      sortino: sortinoRatio(ratioParams),
      standardDeviation: stdev(returns) || 0,
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
      name: 'PerformanceAnalyzer',
      schema: performanceAnalyzerSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(PerformanceAnalyzer.prototype), p => p.startsWith('on')),
      eventsEmitted: [PERFORMANCE_REPORT_EVENT],
    } as const;
  }
}
