import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT } from '@constants/event.const';
import { CandleBucket, OrderCompletedEvent, RoundTrip } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import { info, warning } from '@services/logger';
import {
  calculateAlpha,
  calculateAnnualizedReturnPct,
  calculateDownsideDeviation,
  calculateElapsedYears,
  calculateExposurePct,
  calculateMarketReturnPct,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateTotalReturnPct,
  calculateWinRate,
  extractTopMAEs,
} from '@utils/finance/stats.utils';
import { stdev } from '@utils/math/math.utils';
import { round } from '@utils/math/round.utils';
import { calculatePairEquity, getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { first } from 'lodash-es';
import { Plugin } from '../../plugin';
import { analyzerSchema } from '../analyzer.schema';
import { AnalyzerConfig } from '../analyzer.types';
import { DateRange, SingleRoundTrip, Start, TradingReport } from './roundTrip.types';
import { EMPTY_TRADING_REPORT, PLUGIN_NAME } from './roundTripAnalyzer.const';
import { logFinalize, logRoundtrip } from './roundTripAnalyzer.utils';

export class RoundTripAnalyzer extends Plugin {
  private currentEquity: number;
  private lastPriceUpdate: number;
  private dates: DateRange;
  private endPrice: number;
  private exposure: number;
  private losses: RoundTrip[];
  private openRoundTrip: boolean;
  private riskFreeReturn: number;
  private roundTrip: SingleRoundTrip;
  private roundTrips: RoundTrip[];
  private maxAdverseExcursion: number;
  private start: Start;
  private startPrice: number | null;
  private tradeCount: number;
  private warmupBucket?: CandleBucket;
  private warmupCompleted: boolean;
  private enableConsoleTable: boolean;
  private asset: Asset;
  private symbol: TradingPair;

  constructor({ riskFreeReturn, enableConsoleTable }: AnalyzerConfig) {
    super(PLUGIN_NAME);

    if (this.assets.length !== 1) throw new Error('RoundTripAnalyzer can only be used with a single pair');

    this.symbol = this.pairs[0];
    this.asset = this.assets[0];
    this.currentEquity = 0;
    this.lastPriceUpdate = 0;
    this.dates = { start: 0, end: 0 };
    this.endPrice = 0;
    this.exposure = 0;
    this.losses = [];
    this.openRoundTrip = false;
    this.riskFreeReturn = riskFreeReturn ?? 1;
    this.roundTrip = { entry: null, exit: null };
    this.roundTrips = [];
    this.maxAdverseExcursion = 0;
    this.start = { equity: 0, portfolio: null };
    this.startPrice = null;
    this.tradeCount = 0;
    this.warmupCompleted = false;
    this.enableConsoleTable = enableConsoleTable;
  }

  // --- BEGIN LISTENERS ---

  public onPortfolioChange(events: Portfolio[]): void {
    // Latest strategy: only process the most recent payload
    const portfolio = events[events.length - 1];
    const { total } = calculatePairEquity(portfolio, this.symbol, this.lastPriceUpdate);
    if (!this.start.portfolio) this.start.portfolio = portfolio;
    if (!this.start.equity) this.start.equity = total;
    this.currentEquity = total;
  }

  public onStrategyWarmupCompleted(timeframeBuckets: CandleBucket[]): void {
    // Only one warmup event is expected
    const timeframeBucket = first(timeframeBuckets);
    const candle = timeframeBucket?.get(this.symbol);
    if (!candle) {
      warning('roundtrip analyzer', `Missing candle for ${this.symbol} during warmup completion.`);
      return;
    }
    this.warmupCompleted = true;
    this.dates.start = candle.start;
    this.startPrice = candle.close;
    if (this.warmupBucket) this.processOneMinuteBucket(this.warmupBucket);
  }

  public onOrderCompleted(events: OrderCompletedEvent[]): void {
    for (const event of events) {
      if (this.tradeCount === 0 && event.order.side === 'SELL') return;
      this.tradeCount++;
      this.registerRoundtripPart(event);
    }
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---

  private registerRoundtripPart({ order, exchange }: OrderCompletedEvent): void {
    if (order.price == null || order.price <= 0) {
      warning('roundtrip analyzer', `Order ${order.id} completed without a valid price. Skipping roundtrip update.`);
      return;
    }

    const pairEquity = calculatePairEquity(exchange.portfolio, this.symbol, order.price);
    const assetAmount = getAssetBalance(exchange.portfolio, this.asset).total;
    const currencyAmount = getAssetBalance(exchange.portfolio, this.currency).total;

    if (order.side === 'BUY') {
      if (this.roundTrip.exit) this.roundTrip.exit = null;
      this.roundTrip.entry = {
        date: order.orderExecutionDate,
        price: order.price ?? 0,
        total: pairEquity.total,
        asset: assetAmount,
        currency: currencyAmount,
      };
      this.maxAdverseExcursion = 0;
      this.openRoundTrip = true;
    } else if (order.side === 'SELL') {
      this.roundTrip.exit = {
        date: order.orderExecutionDate,
        price: order.price ?? 0,
        total: pairEquity.total,
        asset: assetAmount,
        currency: currencyAmount,
      };
      this.openRoundTrip = false;
      this.currentEquity = pairEquity.total;

      this.handleCompletedRoundtrip();
    }
  }

  private handleCompletedRoundtrip(): void {
    if (!this.roundTrip.entry || !this.roundTrip.exit) return;

    const roundtrip: RoundTrip = {
      id: this.roundTrips.length,

      entryAt: this.roundTrip.entry.date,
      entryPrice: this.roundTrip.entry.price,
      entryEquity: this.roundTrip.entry.total,

      exitAt: this.roundTrip.exit.date,
      exitPrice: this.roundTrip.exit.price,
      exitEquity: this.roundTrip.exit.total,

      pnl: this.roundTrip.exit.total - this.roundTrip.entry.total,
      profit: this.roundTrip.entry.total ? (100 * this.roundTrip.exit.total) / this.roundTrip.entry.total - 100 : 0,
      maxAdverseExcursion: this.maxAdverseExcursion,

      duration: differenceInMilliseconds(this.roundTrip.exit.date, this.roundTrip.entry.date),
    };

    this.roundTrips.push(roundtrip);

    // reset MAE tracker for next roundtrip
    this.maxAdverseExcursion = 0;

    logRoundtrip(roundtrip, this.currency, this.enableConsoleTable);

    this.addDeferredEmit<RoundTrip>(ROUNDTRIP_COMPLETED_EVENT, roundtrip);

    // update cached exposure
    this.exposure = this.exposure + roundtrip.duration;
    // track losses separately for downside report
    if (roundtrip.exitEquity < roundtrip.entryEquity) this.losses.push(roundtrip);
  }

  private calculateReportStatistics(): TradingReport {
    if (!this.start.equity || !this.start.portfolio || !this.startPrice) {
      warning('roundtrip analyzer', 'No portfolio data received. Emitting empty report.');
      return EMPTY_TRADING_REPORT;
    }

    // Time calculations
    const timespan = intervalToDuration({ start: this.dates.start, end: this.dates.end });
    const elapsedYears = calculateElapsedYears(this.dates.start, this.dates.end);

    if (elapsedYears < 0.01) {
      warning(
        'roundtrip analyzer',
        `Elapsed period is very short (${elapsedYears.toFixed(4)} years). Annualized metrics may be unreliable.`,
      );
    }

    // Core return metrics
    const netProfit = this.currentEquity - this.start.equity;
    const totalReturnPct = calculateTotalReturnPct(this.currentEquity, this.start.equity);
    const annualizedReturnPct = calculateAnnualizedReturnPct(totalReturnPct, Math.max(elapsedYears, Number.EPSILON));
    const marketReturnPct = calculateMarketReturnPct(this.endPrice, this.startPrice);

    // Exposure and trades
    const totalMs = differenceInMilliseconds(this.dates.end, this.dates.start);
    const exposurePct = calculateExposurePct(this.exposure, totalMs);
    const positiveRoundtrips = this.roundTrips.filter(rt => rt.pnl > 0);
    const winRate = calculateWinRate(positiveRoundtrips.length, this.roundTrips.length);

    // Risk metrics
    const allProfits = this.roundTrips.map(r => r.profit);
    const downsideDeviation = calculateDownsideDeviation(allProfits);
    const volatility = stdev(allProfits);
    const standardDeviation = Number.isNaN(volatility) ? 0 : volatility;

    const ratioParams = {
      returns: allProfits,
      yearlyProfit: annualizedReturnPct,
      riskFreeReturn: this.riskFreeReturn,
      elapsedYears: Math.max(elapsedYears, 0.01),
    };

    const report: TradingReport = {
      id: 'TRADING REPORT',
      alpha: calculateAlpha(totalReturnPct, marketReturnPct),
      finalBalance: this.currentEquity,
      downsideDeviation,
      periodEndAt: this.dates.end,
      periodStartAt: this.dates.start,
      exposurePct,
      marketReturnPct,
      netProfit,
      winRate: winRate !== null ? round(winRate, 4) : null,
      topMAEs: extractTopMAEs(this.roundTrips.map(rt => rt.maxAdverseExcursion)),
      totalReturnPct,
      annualizedReturnPct,
      sharpeRatio: calculateSharpeRatio(ratioParams),
      sortinoRatio: calculateSortinoRatio(ratioParams),
      volatility: standardDeviation,
      startBalance: this.start.equity,
      startPrice: this.startPrice,
      endPrice: this.endPrice,
      formattedDuration: formatDuration(timespan),
      tradeCount: this.tradeCount,
      annualizedNetProfit: netProfit / (elapsedYears || 1),
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

  protected processOneMinuteBucket(bucket: CandleBucket): void {
    const candle = bucket.get(this.symbol);
    if (!candle) {
      warning('roundtrip analyzer', `Missing candle for ${this.symbol} in bucket.`);
      return;
    }
    this.lastPriceUpdate = candle.close;
    if (this.warmupCompleted) {
      this.dates.end = addMinutes(candle.start, 1).getTime();
      this.endPrice = candle.close;
      if (this.openRoundTrip && this.roundTrip.entry) {
        const adverse = ((this.roundTrip.entry.price - candle.low) / this.roundTrip.entry.price) * 100;
        if (adverse > this.maxAdverseExcursion) this.maxAdverseExcursion = adverse;
      }
    } else {
      this.warmupBucket = bucket;
    }
  }

  protected processFinalize(): void {
    const report = this.calculateReportStatistics();
    if (this.enableConsoleTable) logFinalize(report, this.currency);
    else info('roundtrip analyzer', report);

    // Emit directly: processFinalize is the final lifecycle hook.
    this.emit<TradingReport>(PERFORMANCE_REPORT_EVENT, report);
  }

  public static getStaticConfiguration() {
    return {
      schema: analyzerSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: Object.getOwnPropertyNames(RoundTripAnalyzer.prototype).filter(p => p.startsWith('on')),
      eventsEmitted: [PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT],
      name: PLUGIN_NAME,
    };
  }
}
