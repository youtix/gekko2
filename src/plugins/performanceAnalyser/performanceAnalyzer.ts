import { Candle } from '@models/types/candle.types';
import { Portfolio } from '@models/types/portfolio.types';
import { RoundTrip } from '@models/types/roundtrip.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { warning } from '@services/logger';
import { percentile, stdev } from '@utils/math/math.utils';
import { round } from '@utils/math/round.utils';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { filter } from 'lodash-es';
import { Plugin } from '../plugin';
import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT } from '../plugin.const';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';
import { DateRange, PerformanceAnalyzerConfig, Report, SingleRoundTrip, Start } from './performanceAnalyzer.types';
import { logFinalize, logRoundtrip } from './performanceAnalyzer.utils';

const YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export class PerformanceAnalyzer extends Plugin {
  private balance: number;
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
  private startPrice: number;
  private trades: number;
  private warmupCandle?: Candle;
  private warmupCompleted: boolean;
  private enableConsoleTable: boolean;

  constructor({ riskFreeReturn, enableConsoleTable }: PerformanceAnalyzerConfig) {
    super(PerformanceAnalyzer.name);

    this.balance = 0;
    this.dates = { start: 0, end: 0 };
    this.endPrice = 0;
    this.exposure = 0;
    this.losses = [];
    this.openRoundTrip = false;
    this.riskFreeReturn = riskFreeReturn ?? 1;
    this.roundTrip = { id: 0, entry: null, exit: null };
    this.roundTrips = [];
    this.maxAdverseExcursion = 0;
    this.start = { balance: 0, portfolio: null };
    this.startPrice = 0;
    this.trades = 0;
    this.warmupCompleted = false;
    this.enableConsoleTable = enableConsoleTable;
  }

  // --- BEGIN LISTENERS ---
  public onPortfolioValueChange(event: { balance: number }): void {
    if (!this.start.balance) this.start.balance = event.balance;
    this.balance = event.balance;
  }

  public onPortfolioChange(event: Portfolio): void {
    if (!this.start.portfolio) this.start.portfolio = event;
  }

  public onStrategyWarmupCompleted({ start, close }: Candle): void {
    this.warmupCompleted = true;
    this.dates.start = start;
    this.startPrice = close;
    if (this.warmupCandle) this.processOneMinuteCandle(this.warmupCandle);
  }

  public onTradeCompleted(trade: TradeCompleted): void {
    if (this.trades === 0 && trade.action === 'sell') return;

    this.trades++;
    this.balance = trade.balance;

    this.registerRoundtripPart(trade);
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---

  private registerRoundtripPart(trade: TradeCompleted): void {
    if (trade.action === 'buy') {
      if (this.roundTrip.exit) {
        this.roundTrip.id++;
        this.roundTrip.exit = null;
      }
      this.roundTrip.entry = {
        date: trade.date,
        price: trade.price,
        total: trade.portfolio.asset * trade.price + trade.portfolio.currency,
        asset: trade.portfolio.asset,
        currency: trade.portfolio.currency,
      };
      this.maxAdverseExcursion = 0;
      this.openRoundTrip = true;
    } else if (trade.action === 'sell') {
      this.roundTrip.exit = {
        date: trade.date,
        price: trade.price,
        total: trade.portfolio.asset * trade.price + trade.portfolio.currency,
        asset: trade.portfolio.asset,
        currency: trade.portfolio.currency,
      };
      this.openRoundTrip = false;

      this.handleCompletedRoundtrip();
    }
  }

  private handleCompletedRoundtrip(): void {
    if (!this.roundTrip.entry || !this.roundTrip.exit) return;

    const roundtrip: RoundTrip = {
      id: this.roundTrip.id,

      entryAt: this.roundTrip.entry.date,
      entryPrice: this.roundTrip.entry.price,
      entryBalance: this.roundTrip.entry.total,

      exitAt: this.roundTrip.exit.date,
      exitPrice: this.roundTrip.exit.price,
      exitBalance: this.roundTrip.exit.total,

      pnl: this.roundTrip.exit.total - this.roundTrip.entry.total,
      profit: this.roundTrip.entry.total ? (100 * this.roundTrip.exit.total) / this.roundTrip.entry.total - 100 : 0,
      maxAdverseExcursion: this.maxAdverseExcursion,

      duration: differenceInMilliseconds(this.roundTrip.exit.date, this.roundTrip.entry.date),
    };

    this.roundTrips[this.roundTrip.id] = roundtrip;

    // reset MAE tracker for next roundtrip
    this.maxAdverseExcursion = 0;

    logRoundtrip(roundtrip, this.currency, this.enableConsoleTable);

    this.deferredEmit<RoundTrip>(ROUNDTRIP_COMPLETED_EVENT, roundtrip);

    // update cached exposure
    this.exposure = this.exposure + roundtrip.duration;
    // track losses separately for downside report
    if (roundtrip.exitBalance < roundtrip.entryBalance) this.losses.push(roundtrip);
  }

  private calculateReportStatistics() {
    if (!this.start.balance || !this.start.portfolio)
      return warning(
        'performance analyzer',
        'Cannot calculate a profit report without having received portfolio data. Skipping performanceReport..',
      );

    // TODO: When no trades are done, should send an empty report

    // the portfolio's balance is measured in {currency}
    const profit = this.balance - this.start.balance;

    const timespan = intervalToDuration({
      start: this.dates.start,
      end: this.dates.end,
    });
    const elapsedYears = differenceInMilliseconds(this.dates.end, this.dates.start) / YEAR_MS;
    const relativeProfit = (this.balance / this.start.balance) * 100 - 100;
    const relativeYearlyProfit = relativeProfit / (elapsedYears || 1);

    const percentExposure = (this.exposure / differenceInMilliseconds(this.dates.end, this.dates.start)) * 100;

    const volatility = stdev(this.roundTrips.map(r => r.profit));
    const standardDeviation = Number.isNaN(volatility) ? 0 : volatility;
    const sharpe = !standardDeviation ? 0 : (relativeYearlyProfit - this.riskFreeReturn) / standardDeviation;

    const tradeCount = this.trades > 2 ? this.trades - 2 : 1;
    const downsideLosses = this.losses.map(r => r.profit);
    const downside =
      downsideLosses.length > 0 ? Math.sqrt(this.trades / tradeCount) * percentile(downsideLosses, 0.25) : 0;

    const positiveRoundtrips = this.roundTrips.filter(roundTrip => roundTrip.pnl > 0);

    const ratioRoundTrips =
      this.roundTrips.length > 0 ? round((positiveRoundtrips.length / this.roundTrips.length) * 100, 4) : null;

    const market = ((this.endPrice - this.startPrice) / this.startPrice) * 100;

    const worstMaxAdverseExcursion = Math.max(0, ...this.roundTrips.map(r => r.maxAdverseExcursion));

    const report: Report = {
      alpha: relativeProfit - market,
      balance: this.balance,
      downside,
      endPrice: this.endPrice,
      endTime: this.dates.end,
      exposure: percentExposure,
      market,
      profit,
      ratioRoundTrips,
      worstMaxAdverseExcursion,
      relativeProfit: relativeProfit,
      relativeYearlyProfit,
      sharpe,
      standardDeviation,
      startBalance: this.start.balance,
      startPrice: this.startPrice,
      startTime: this.dates.start,
      duration: formatDuration(timespan),
      trades: this.trades,
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
      if (this.openRoundTrip && this.roundTrip.entry) {
        const adverse = ((this.roundTrip.entry.price - candle.low) / this.roundTrip.entry.price) * 100;
        if (adverse > this.maxAdverseExcursion) this.maxAdverseExcursion = adverse;
      }
    } else {
      this.warmupCandle = candle;
    }
  }

  protected processFinalize(): void {
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
      eventsEmitted: [PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT],
      name: 'PerformanceAnalyzer',
    };
  }
}
