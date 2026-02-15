import { EQUITY_SNAPSHOT_EVENT, PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import { CandleBucket, EquitySnapshot, OrderCompletedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import {
  calculateAlpha,
  calculateAnnualizedReturnPct,
  calculateDownsideDeviation,
  calculateElapsedYears,
  calculateExposurePct,
  calculateLongestDrawdownDuration,
  calculateMarketReturnPct,
  calculateMaxDrawdown,
  calculateReturns,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateTotalReturnPct,
  RatioParams,
} from '@utils/finance/stats.utils';
import { stdev } from '@utils/math/math.utils';
import { calculatePortfolioTotalValue } from '@utils/portfolio/portfolio.utils';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { first } from 'lodash-es';
import { Plugin } from '../../plugin';
import { analyzerSchema } from '../analyzer.schema';
import { AnalyzerConfig } from '../analyzer.types';
import { DEFAULT_BENCHMARK_ASSET, EMPTY_PORTFOLIO_REPORT, PLUGIN_NAME } from './portfolioAnalyzer.const';
import { PortfolioReport } from './portfolioAnalyzer.types';
import { logPortfolioReport } from './portfolioAnalyzer.utils';

export class PortfolioAnalyzer extends Plugin {
  // Configuration
  private readonly riskFreeReturn: number;
  private readonly enableConsoleTable: boolean;
  private readonly benchmarkAsset: Asset;

  // State
  private equityCurve: EquitySnapshot[] = [];
  private latestPrices: Map<TradingPair, number> = new Map();
  private startEquity: number = 0;
  private startBenchmarkPrice: number = 0;
  private endBenchmarkPrice: number = 0;
  private dates: { start: number; end: number } = { start: 0, end: 0 };
  private warmupCompleted: boolean = false;
  private portfolioChangeCount: number = 0;

  constructor({ riskFreeReturn, enableConsoleTable }: AnalyzerConfig) {
    super(PLUGIN_NAME);

    this.riskFreeReturn = riskFreeReturn ?? 5;
    this.enableConsoleTable = enableConsoleTable ?? false;
    this.benchmarkAsset = this.assets.includes(DEFAULT_BENCHMARK_ASSET) ? DEFAULT_BENCHMARK_ASSET : this.assets[0];
  }

  // --- BEGIN LISTENERS ---

  public onPortfolioChange(payloads: Portfolio[]): void {
    const portfolio = payloads[payloads.length - 1];

    // We can only calculate portfolio value if we have prices for all assets
    if (!this.hasAllPrices()) return;

    this.portfolioChangeCount++;
    const totalValue = calculatePortfolioTotalValue(portfolio, this.latestPrices, this.currency, this.assets);

    // Record start equity on first valid portfolio change if not set
    if (this.startEquity === 0) this.startEquity = totalValue;

    // Only record snapshots after warmup
    if (this.warmupCompleted) this.recordSnapshot(Date.now(), totalValue);
  }

  public onOrderCompleted(payloads: OrderCompletedEvent[]): void {
    for (const { order, exchange } of payloads) {
      // Re-calculate equity and emit snapshot for live dashboards
      if (!this.warmupCompleted || !this.hasAllPrices()) return;

      // Use the portfolio from the event which reflects the post-order state
      const totalValue = calculatePortfolioTotalValue(exchange.portfolio, this.latestPrices, this.currency, this.assets);

      this.recordSnapshot(order.orderExecutionDate, totalValue);
      this.addDeferredEmit<EquitySnapshot>(EQUITY_SNAPSHOT_EVENT, { date: order.orderExecutionDate, totalValue });
    }
  }

  public onStrategyWarmupCompleted(timeframeBuckets: CandleBucket[]): void {
    // Only one warmup event is expected
    const timeframeBucket = first(timeframeBuckets);
    if (!timeframeBucket) {
      warning('portfolio analyzer', 'Missing timeframe bucket during warmup completion.');
      return;
    }
    this.warmupCompleted = true;

    // Initialize benchmark tracking BTC if available, otherwise use first asset
    const benchmarkPair = `${this.benchmarkAsset}/${this.currency}` as TradingPair;
    const benchmarkCandle = timeframeBucket.get(benchmarkPair);

    if (benchmarkCandle) {
      this.dates.start = benchmarkCandle.start;
      this.startBenchmarkPrice = benchmarkCandle.close;
    } else {
      warning('portfolio analyzer', `Missing benchmark candle for ${benchmarkPair} during warmup completion.`);
    }

    // Process any buffered processing if needed (not needed here as we pull from bucket)
  }

  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---

  private hasAllPrices(): boolean {
    for (const pair of this.pairs) {
      if (!this.latestPrices.has(pair)) return false;
    }
    return true;
  }

  private recordSnapshot(date: number, totalValue: number): void {
    const snapshot: EquitySnapshot = { date, totalValue };
    this.equityCurve.push(snapshot);
  }

  private calculateReportStatistics(): PortfolioReport {
    if (this.startEquity === 0 || this.equityCurve.length === 0) {
      warning('portfolio analyzer', 'Insufficient data for report generation.');
      return EMPTY_PORTFOLIO_REPORT;
    }

    const lastSnapshot = this.equityCurve[this.equityCurve.length - 1];
    const firstSnapshot = this.equityCurve[0];

    // Ensure dates are set correctly if not captured during warmup
    if (this.dates.start === 0) this.dates.start = firstSnapshot.date;
    if (this.dates.end === 0) this.dates.end = lastSnapshot.date;

    // Use last known benchmark price if available

    const benchmarkReturnPct = this.calculateBenchmarkReturn();

    // Time calculations
    const elapsedYears = calculateElapsedYears(this.dates.start, this.dates.end);
    const totalMs = differenceInMilliseconds(this.dates.end, this.dates.start);
    const timespan = intervalToDuration({ start: this.dates.start, end: this.dates.end });

    // Core Metrics
    const endEquity = this.equityCurve[this.equityCurve.length - 1].totalValue;
    const netProfit = endEquity - this.startEquity;

    // Returns
    const totalReturnPct = calculateTotalReturnPct(endEquity, this.startEquity);
    const annualizedReturnPct = calculateAnnualizedReturnPct(totalReturnPct, Math.max(elapsedYears, Number.EPSILON)); // Avoid div by zero

    // Risk Metrics
    const returns = calculateReturns(this.equityCurve);
    const volatility = stdev(returns);
    const standardDeviation = Number.isNaN(volatility) ? 0 : volatility;
    const downsideDeviation = calculateDownsideDeviation(returns); // Note: this usually expects per-trade profits, but passing periodic returns is an approximation for portfolio view

    const ratioParams: RatioParams = {
      returns,
      yearlyProfit: annualizedReturnPct,
      riskFreeReturn: this.riskFreeReturn,
      elapsedYears: Math.max(elapsedYears, 0.0001),
    };

    const maxDrawdownPct = calculateMaxDrawdown(
      this.equityCurve.map(s => s.totalValue),
      this.startEquity,
    );
    const longestDrawdownMs = calculateLongestDrawdownDuration(this.equityCurve, this.startEquity);

    return {
      id: 'PORTFOLIO PROFIT REPORT',
      alpha: calculateAlpha(totalReturnPct, benchmarkReturnPct),
      downsideDeviation,
      periodEndAt: this.dates.end,
      periodStartAt: this.dates.start,
      exposurePct: calculateExposurePct(totalMs, totalMs), // Portfolio is always exposed in MTM view (assets + currency)
      marketReturnPct: benchmarkReturnPct,
      netProfit,
      totalReturnPct,
      annualizedReturnPct,
      sharpeRatio: calculateSharpeRatio(ratioParams),
      sortinoRatio: calculateSortinoRatio(ratioParams),
      volatility: standardDeviation,
      startPrice: this.startBenchmarkPrice,
      endPrice: this.endBenchmarkPrice,
      formattedDuration: formatDuration(timespan),
      annualizedNetProfit: netProfit / (elapsedYears || 1),
      equityCurve: this.equityCurve,
      maxDrawdownPct,
      longestDrawdownMs,
      startEquity: this.startEquity,
      endEquity,
      portfolioChangeCount: this.portfolioChangeCount,
      benchmarkAsset: this.benchmarkAsset,
    };
  }

  private calculateBenchmarkReturn(): number {
    if (this.startBenchmarkPrice <= 0 || this.endBenchmarkPrice <= 0) return 0;
    return calculateMarketReturnPct(this.endBenchmarkPrice, this.startBenchmarkPrice);
  }

  // --- END INTERNALS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processOneMinuteBucket(bucket: CandleBucket): void {
    // Update prices for all assets
    for (const asset of this.assets) {
      const pair = `${asset}/${this.currency}` as TradingPair;
      const candle = bucket.get(pair);
      if (candle) {
        this.latestPrices.set(pair, candle.close);

        // Track benchmark asset price (first asset)
        if (asset === this.benchmarkAsset) this.endBenchmarkPrice = candle.close;
      }
    }

    if (this.warmupCompleted) {
      // Use the start time of the first candle in the bucket to update progress/time
      // Taking the first available candle's start time
      const firstCandle = bucket.values().next().value;
      if (firstCandle) this.dates.end = addMinutes(firstCandle.start, 1).getTime();
    }
  }

  protected processFinalize(): void {
    const report = this.calculateReportStatistics();
    this.addDeferredEmit<PortfolioReport>(PERFORMANCE_REPORT_EVENT, report);

    // Log using logger if console table is enabled
    if (this.enableConsoleTable) logPortfolioReport(report, this.currency);
  }

  public static getStaticConfiguration() {
    return {
      schema: analyzerSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: Object.getOwnPropertyNames(PortfolioAnalyzer.prototype).filter(p => p.startsWith('on')),
      eventsEmitted: [PERFORMANCE_REPORT_EVENT, EQUITY_SNAPSHOT_EVENT],
      name: PLUGIN_NAME,
    };
  }
}
