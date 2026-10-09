import { EQUITY_SNAPSHOT_EVENT, PERFORMANCE_REPORT_EVENT } from '@constants/event.const';
import {
  CandleBucket,
  EquitySnapshot,
  OrderCanceledEvent,
  OrderCompletedEvent,
  OrderErroredEvent,
  OrderInitiatedEvent,
} from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import { info, warning } from '@services/logger';
import { getFirstCandleFromBucket } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import {
  calculateLongestDrawdownDuration,
  calculateMarketReturnPct,
  calculateMaxDrawdown,
  calculateReturns,
} from '@utils/finance/stats.utils';
import { calculatePortfolioTotalValue, getAssetBalance, isFetchedPortfolio } from '@utils/portfolio/portfolio.utils';
import { addMinutes } from 'date-fns';
import { first, isNil, omit } from 'lodash-es';
import { Plugin } from '../../plugin';
import { DUST_TOLERANCE } from '../analyzer.const';
import { analyzerSchema } from '../analyzer.schema';
import { AnalyzerConfig } from '../analyzer.types';
import { calculatePerformanceStatistics } from '../analyzer.utils';
import { DEFAULT_BENCHMARK_ASSET, EMPTY_PORTFOLIO_REPORT, PLUGIN_NAME } from './portfolioAnalyzer.const';
import { PortfolioReport } from './portfolioAnalyzer.types';
import { logPortfolioReport } from './portfolioAnalyzer.utils';

export class PortfolioAnalyzer extends Plugin {
  // Configuration
  private readonly riskFreeReturn: number;
  private readonly enableConsoleTable: boolean;
  private readonly benchmarkAsset: Asset;

  // State
  /**
   * The latest portfolio marked to market at the close of every timeframe candle after the warmup (see onTimeframeCandle), and once
   * more at the end of the period (see markEnd). A regular series, as the annualization of the Sharpe and Sortino ratios assumes (see
   * calculateSharpeRatio): a point at each fill would split the return of a timeframe in two, adding an observation of a few minutes,
   * and the ratios would move with the number of trades. So would a point at each portfolio change, which the Trader sends on its own
   * clock, with its synchronizations and its fills.
   */
  private equityCurve: EquitySnapshot[] = [];
  private latestPrices: Map<TradingPair, number> = new Map();
  /**
   * The most recent portfolio received: the one the start equity values when the warmup completes, and the one marked to market (see
   * equityCurve). A portfolio change brings it, and so does the end of an order, completed, canceled or in error, which carries the
   * portfolio the Trader read after it: never older than the portfolio change queued before it, and the only news of a fill whose
   * change the portfolioUpdates filter of the Trader holds back, as it does for a fill that moves no balance enough. An order may end in
   * error after a partial fill. Not the empty portfolio of a Trader that has fetched none yet (see refreshLatestPortfolio).
   */
  private latestPortfolio: Portfolio | null = null;
  /**
   * The value of the portfolio the period starts from: the latest portfolio received when the warmup completes, valued at the closes
   * of the bucket that completed it, the prices the benchmark starts from too. A portfolio received during the warmup must not give
   * it at the prices of its own minute: they move until the warmup completes, and the return of the run would count that move.
   * Without a portfolio by then, it is the first one received after the warmup, valued at the prices known then.
   */
  private startEquity: number | null = null;
  /** The end of the minute whose closes are the start prices: that of the bucket that completed the warmup */
  private startPricesAt: EpochTimeStamp = 0;
  private startBenchmarkPrice: number = 0;
  private endBenchmarkPrice: number = 0;
  private dates: { start: number; end: number } = { start: 0, end: 0 };
  /**
   * The time of the period during which the portfolio held an asset other than the currency, worth more than dust at the latest prices
   * (see holdsAsset). It is counted a timeframe at a time: the span between two marks counts in full when the portfolio marked at its
   * end, the one held through it, holds such an asset (see countExposureUntil).
   */
  private exposureMs: number = 0;
  /** The end of the last span counted in exposureMs: the last mark, the start of the period before the first one */
  private markedAt: EpochTimeStamp = 0;
  private warmupCompleted: boolean = false;
  private portfolioChangeCount: number = 0;
  private currentTimestamp: EpochTimeStamp = 0;

  constructor({ riskFreeReturn, enableConsoleTable }: AnalyzerConfig) {
    super(PLUGIN_NAME);

    this.riskFreeReturn = riskFreeReturn ?? 5;
    this.enableConsoleTable = enableConsoleTable ?? false;
    this.benchmarkAsset = this.assets.includes(DEFAULT_BENCHMARK_ASSET) ? DEFAULT_BENCHMARK_ASSET : this.assets[0];
  }

  // --- BEGIN LISTENERS ---

  public onPortfolioChange(payloads: Portfolio[]): void {
    const portfolio = payloads[payloads.length - 1];
    this.latestPortfolio = portfolio;

    // We can only calculate portfolio value if we have prices for all assets
    if (!this.hasAllPrices()) return;

    this.portfolioChangeCount++;

    // The equity curve is marked on the timeframe candles (see equityCurve). The start equity is taken when the warmup completes (see
    // startEquity), unless no portfolio could be valued then.
    if (!this.warmupCompleted || !isNil(this.startEquity)) return;
    this.takeLateStartEquity(calculatePortfolioTotalValue(portfolio, this.latestPrices, this.currency, this.assets));
  }

  /** Refreshes the latest portfolio with the one after the fill (see latestPortfolio): a fill adds no point to the curve (equityCurve) */
  public onOrderCompleted(payloads: OrderCompletedEvent[]): void {
    this.refreshLatestPortfolio(payloads);
  }

  /** Refreshes the latest portfolio with the one after the cancelation, the part the order filled included (see latestPortfolio) */
  public onOrderCanceled(payloads: OrderCanceledEvent[]): void {
    this.refreshLatestPortfolio(payloads);
  }

  /** Refreshes the latest portfolio with the one after the error, which may follow a partial fill (see latestPortfolio) */
  public onOrderErrored(payloads: OrderErroredEvent[]): void {
    this.refreshLatestPortfolio(payloads);
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
      this.startBenchmarkPrice = benchmarkCandle.close;
    } else {
      warning('portfolio analyzer', `Missing benchmark candle for ${benchmarkPair} during warmup completion.`);
    }

    // The period starts at the close of the timeframe candle that completed the warmup, the end of the bucket that completed it: the
    // start prices and the start equity are taken then, and the strategy acts from then on. The start of that candle, a timeframe
    // earlier, would stretch the period by a timeframe and understate the annualized return. It ends there too until the next bucket.
    this.dates = { start: this.currentTimestamp, end: this.currentTimestamp };
    this.markedAt = this.currentTimestamp;

    // The latest portfolio, valued at the closes of the bucket that completed the warmup: processOneMinuteBucket recorded them before
    // this event was delivered (see startEquity). Without one yet, the next portfolio received gives the start equity.
    this.startPricesAt = this.currentTimestamp;
    if (this.latestPortfolio && this.hasAllPrices())
      this.startEquity = calculatePortfolioTotalValue(this.latestPortfolio, this.latestPrices, this.currency, this.assets);

    // Process any buffered processing if needed (not needed here as we pull from bucket)
  }

  /**
   * Marks the latest portfolio to market at the close of every timeframe candle after the warmup, that which completed it included
   * (see equityCurve). The event comes with the bucket that closed the candle: processOneMinuteBucket has recorded its closes as the
   * latest prices, and its end as the current timestamp. It comes before the orders the strategy places at that close are filled.
   */
  public onTimeframeCandle(_timeframeBuckets: CandleBucket[]): void {
    if (!this.warmupCompleted) return;
    this.countExposureUntil(this.currentTimestamp);

    const portfolio = this.latestPortfolio;
    if (!portfolio || !this.hasAllPrices()) return;
    const totalValue = calculatePortfolioTotalValue(portfolio, this.latestPrices, this.currency, this.assets);
    // The start equity is taken when the warmup completes (see startEquity), unless no portfolio could be valued then
    if (isNil(this.startEquity)) this.takeLateStartEquity(totalValue);
    else this.recordSnapshot(this.currentTimestamp, totalValue);
  }

  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---

  /** Takes the portfolio the last of these order events carries as the latest (see latestPortfolio), unless the Trader had fetched none */
  private refreshLatestPortfolio(payloads: OrderInitiatedEvent[]): void {
    const { portfolio } = payloads[payloads.length - 1].exchange;
    if (isFetchedPortfolio(portfolio)) this.latestPortfolio = portfolio;
  }

  private hasAllPrices(): boolean {
    for (const pair of this.pairs) {
      if (!this.latestPrices.has(pair)) return false;
    }
    return true;
  }

  /**
   * The start equity, from the first portfolio valued after the warmup completed, at the prices known then (see startEquity). It is
   * the first point of the equity curve too, which no timeframe candle could mark without a portfolio.
   */
  private takeLateStartEquity(totalValue: number): void {
    this.startEquity = totalValue;
    this.recordSnapshot(this.currentTimestamp, totalValue);
    // Received before the next bucket, it is valued at the start prices all the same. So is the first portfolio of the Trader with the
    // default warmup of 0 candles: the first bucket completes the warmup, and its end is delivered before that portfolio.
    if (this.currentTimestamp === this.startPricesAt) return;
    warning(
      'portfolio analyzer',
      `No portfolio received during the warmup: start equity taken late, at the prices of ${toISOString(this.currentTimestamp)}.`,
    );
  }

  /** Adds a point to the equity curve, and sends it to the live dashboards */
  private recordSnapshot(date: number, totalValue: number): void {
    const snapshot: EquitySnapshot = { date, totalValue };
    this.equityCurve.push(snapshot);
    this.addDeferredEmit<EquitySnapshot>(EQUITY_SNAPSHOT_EVENT, snapshot);
  }

  /** Counts the span from the last mark to `date` in the exposure when the latest portfolio holds an asset then (see exposureMs) */
  private countExposureUntil(date: EpochTimeStamp): void {
    if (this.latestPortfolio && this.holdsAsset(this.latestPortfolio)) this.exposureMs += date - this.markedAt;
    this.markedAt = date;
  }

  /**
   * Whether the portfolio holds a position: an asset other than the currency worth at least DUST_TOLERANCE of the portfolio at the
   * latest prices. Less is dust left by a SELL (see DUST_TOLERANCE), no position for the RoundTripAnalyzer either: counted, it would
   * expose the rest of the run. The limit of the rule: a position the strategy keeps under 1 % of the equity on purpose is not counted
   * as exposure either.
   */
  private holdsAsset(portfolio: Portfolio): boolean {
    const totalValue = calculatePortfolioTotalValue(portfolio, this.latestPrices, this.currency, this.assets);
    return this.assets.some(asset => {
      const value = getAssetBalance(portfolio, asset).total * (this.latestPrices.get(`${asset}/${this.currency}`) ?? 0);
      // An asset worth nothing is no position, even in a portfolio worth nothing
      return value > 0 && value >= DUST_TOLERANCE * totalValue;
    });
  }

  /**
   * Marks the end of the period: the last span of the exposure, and the last point of the equity curve, the latest portfolio at the
   * last prices. The last bucket may have closed no timeframe candle, and orders may have filled after the last mark: when that mark
   * was taken at the end of the period, its value is replaced, so that the end equity is net of every fill.
   */
  private markEnd(): void {
    if (!this.warmupCompleted) return;
    this.countExposureUntil(this.dates.end);

    const portfolio = this.latestPortfolio;
    if (!portfolio || !this.hasAllPrices() || isNil(this.startEquity)) return;
    const totalValue = calculatePortfolioTotalValue(portfolio, this.latestPrices, this.currency, this.assets);
    const lastSnapshot = this.equityCurve.at(-1);
    // Not recordSnapshot: nothing is sent once the run has ended (see processFinalize)
    if (lastSnapshot?.date === this.dates.end) lastSnapshot.totalValue = totalValue;
    else this.equityCurve.push({ date: this.dates.end, totalValue });
  }

  private calculateReportStatistics(): PortfolioReport {
    if (isNil(this.startEquity) || this.equityCurve.length === 0) {
      warning('portfolio analyzer', 'Insufficient data for report generation.');
      return EMPTY_PORTFOLIO_REPORT;
    }
    // The returns are relative to the start equity: a portfolio worth nothing when the period started has none
    if (this.startEquity <= 0) {
      warning('portfolio analyzer', `Start equity of ${this.startEquity} ${this.currency}: no return to measure. Emitting empty report.`);
      return EMPTY_PORTFOLIO_REPORT;
    }

    // Sort snapshots by date to ensure correct order
    this.equityCurve.sort((a, b) => a.date - b.date);
    const lastSnapshot = this.equityCurve[this.equityCurve.length - 1];
    const firstSnapshot = this.equityCurve[0];

    // Ensure dates are set correctly if not captured during warmup
    if (this.dates.start === 0) this.dates.start = firstSnapshot.date;
    if (this.dates.end === 0) this.dates.end = lastSnapshot.date;

    const endEquity = lastSnapshot.totalValue;
    const statistics = calculatePerformanceStatistics(
      {
        periodStartAt: this.dates.start,
        periodEndAt: this.dates.end,
        startEquity: this.startEquity,
        endEquity,
        // The returns of the equity curve, one per timeframe candle (see equityCurve)
        returns: calculateReturns(this.equityCurve),
        marketReturnPct: this.calculateBenchmarkReturn(),
        // The share of the period the portfolio held an asset (see exposureMs): a portfolio is not exposed for holding currency alone
        exposureMs: this.exposureMs,
        riskFreeReturn: this.riskFreeReturn,
      },
      'portfolio analyzer',
    );

    return {
      id: 'PORTFOLIO PROFIT REPORT',
      ...statistics,
      startPrice: this.startBenchmarkPrice,
      endPrice: this.endBenchmarkPrice,
      equityCurve: this.equityCurve,
      maxDrawdownPct: calculateMaxDrawdown(
        this.equityCurve.map(s => s.totalValue),
        this.startEquity,
      ),
      longestDrawdownMs: calculateLongestDrawdownDuration(this.equityCurve, this.startEquity),
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
    // Throw error if bucket is empty
    const firstCandle = getFirstCandleFromBucket(bucket);
    this.currentTimestamp = addMinutes(firstCandle.start, 1).getTime();

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

    // Use the start time of the first candle in the bucket to update progress/time
    // Taking the first available candle's start time
    if (this.warmupCompleted) this.dates.end = this.currentTimestamp;
  }

  protected processFinalize(failure?: Error): void {
    this.markEnd();
    // A run stopped before its end (a crash, missing candles, the circuit breaker) gives the report of a partial period, and says why
    const report: PortfolioReport = { ...this.calculateReportStatistics(), ...(failure && { interruption: failure.message }) };

    // The equity curve has a point per timeframe candle: on a long backtest it would make the log line megabytes long. The log gets
    // its length, the emitted report keeps the whole curve.
    if (this.enableConsoleTable) logPortfolioReport(report, this.currency);
    else info('portfolio analyzer', { ...omit(report, 'equityCurve'), equityCurveLength: report.equityCurve.length });

    // Emit directly: processFinalize is the final lifecycle hook.
    this.emit<PortfolioReport>(PERFORMANCE_REPORT_EVENT, report);
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
