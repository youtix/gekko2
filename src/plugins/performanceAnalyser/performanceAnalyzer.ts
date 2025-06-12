import { Candle } from '@models/types/candle.types';
import { Portfolio } from '@models/types/portfolio.types';
import { RoundTrip } from '@models/types/roundtrip.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { warning } from '@services/logger';
import { percentile, stdev } from '@utils/math/math.utils';
import { Big } from 'big.js';
import { addMinutes, differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { filter } from 'lodash-es';
import { Plugin } from '../plugin';
import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_EVENT, ROUNDTRIP_UPDATE_EVENT } from './performanceAnalyzer.const';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';
import { DateRange, PerformanceAnalyzerConfig, Report, SingleRoundTrip, Start } from './performanceAnalyzer.types';
import { logFinalize, logRoundtrip } from './performanceAnalyzer.utils';

export class PerformanceAnalyzer extends Plugin {
  private balance: number;
  private dates: DateRange;
  private endPrice: number;
  private exposure: number;
  private losses: RoundTrip[];
  private openRoundTrip: boolean;
  private portfolio: unknown;
  private price: number;
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
    this.portfolio = {};
    this.price = 0;
    this.riskFreeReturn = riskFreeReturn ?? 1;
    this.roundTrip = { id: 0, entry: null, exit: null };
    this.roundTrips = [];
    this.maxAdverseExcursion = 0;
    this.start = { balance: 0 };
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

  public onStrategyWarmupCompleted(): void {
    this.warmupCompleted = true;
    if (this.warmupCandle) this.processCandle(this.warmupCandle);
  }

  public onTradeCompleted(event: TradeCompleted): void {
    this.trades++;
    this.portfolio = event.portfolio;
    this.balance = event.balance;

    this.registerRoundtripPart(event);

    /*
      TODO: Provide an option to emit intermediate reports on trade completed
      const report = this.calculateReportStatistics();
      if (report) {
        logTrade(event, this.currency, this.asset);
        this.deferredEmit(PERFORMANCE_REPORT_EVENT, report);
     }
    */
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---
  private emitRoundtripUpdate(): void {
    if (this.roundTrip.entry) {
      const uPnl = Big(this.price).minus(this.roundTrip.entry.price);
      this.deferredEmit(ROUNDTRIP_UPDATE_EVENT, {
        at: this.dates.end,
        duration: differenceInMilliseconds(this.dates.end, this.roundTrip.entry.date),
        uPnl: +uPnl,
        uProfit: +uPnl.div(this.roundTrip.entry.total).mul(100),
      });
    }
  }

  private registerRoundtripPart(trade: TradeCompleted): void {
    // this is not part of a valid roundtrip
    if (this.trades === 1 && trade.action === 'sell') return;

    if (trade.action === 'buy') {
      if (this.roundTrip.exit) {
        this.roundTrip.id++;
        this.roundTrip.exit = null;
      }
      this.roundTrip.entry = {
        date: trade.date,
        price: trade.price,
        total: +Big(trade.portfolio.asset).mul(trade.price).plus(trade.portfolio.currency),
      };
      this.maxAdverseExcursion = 0;
      this.openRoundTrip = true;
    } else if (trade.action === 'sell') {
      this.roundTrip.exit = {
        date: trade.date,
        price: trade.price,
        total: +Big(trade.portfolio.asset).mul(trade.price).plus(trade.portfolio.currency),
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

      pnl: +Big(this.roundTrip.exit.total).minus(this.roundTrip.entry.total),
      profit: +Big(100).mul(this.roundTrip.exit.total).div(this.roundTrip.entry.total).minus(100),
      maxAdverseExcursion: this.maxAdverseExcursion,

      duration: differenceInMilliseconds(this.roundTrip.exit.date, this.roundTrip.entry.date),
    };

    this.roundTrips[this.roundTrip.id] = roundtrip;

    // reset MAE tracker for next roundtrip
    this.maxAdverseExcursion = 0;

    logRoundtrip(roundtrip, this.currency, this.enableConsoleTable);

    this.deferredEmit<RoundTrip>(ROUNDTRIP_EVENT, roundtrip);

    // update cached exposure
    this.exposure = +Big(this.exposure).plus(roundtrip.duration);
    // track losses separately for downside report
    if (roundtrip.exitBalance < roundtrip.entryBalance) this.losses = [...this.losses, roundtrip];
  }

  private calculateReportStatistics() {
    if (!this.start.balance || !this.start.portfolio)
      return warning(
        'performance analyzer',
        'Cannot calculate a profit report without having received portfolio data. Skipping performanceReport..',
      );

    // TODO: When no trades are done, should send an empty report

    // the portfolio's balance is measured in {currency}
    const profit = +Big(this.balance).minus(this.start.balance);

    const timespan = intervalToDuration({
      start: this.dates.start,
      end: this.dates.end,
    });
    const relativeProfit = +Big(this.balance).div(this.start.balance).mul(100).minus(100);
    const relativeYearlyProfit = +Big(relativeProfit).div(timespan.years || 1);

    const percentExposure = +Big(this.exposure).div(differenceInMilliseconds(this.dates.end, this.dates.start));

    const sharpe = +Big(relativeYearlyProfit)
      .minus(this.riskFreeReturn)
      .div(stdev(this.roundTrips.map(r => r.profit)) || 1);

    const tradeCount = this.trades > 2 ? this.trades - 2 : 1;
    const downsideLosses = this.losses.map(r => r.profit);
    const downside =
      downsideLosses.length > 0 ? +Big(this.trades).div(tradeCount).sqrt().mul(percentile(downsideLosses, 0.25)) : 0;

    const positiveRoundtrips = this.roundTrips.filter(roundTrip => roundTrip.pnl > 0);

    const ratioRoundTrips =
      this.roundTrips.length > 0 ? +Big(positiveRoundtrips.length).div(this.roundTrips.length).mul(100).round(4) : 100;

    const market = +Big(this.endPrice).minus(this.startPrice).div(this.startPrice).mul(100);

    const worstMaxAdverseExcursion = Math.max(
      0,
      ...this.roundTrips.map(r => r.maxAdverseExcursion),
    );

    const report: Report = {
      alpha: +Big(relativeProfit).minus(market),
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
      startBalance: this.start.balance,
      startPrice: this.startPrice,
      startTime: this.dates.start,
      duration: formatDuration(timespan),
      trades: this.trades,
      yearlyProfit: +Big(profit).div(timespan.years || 1),
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

  protected processCandle(candle: Candle): void {
    if (this.warmupCompleted) {
      this.price = candle.close;
      this.dates.end = addMinutes(candle.start, 1).getTime();

      if (!this.dates.start) {
        this.dates.start = candle.start;
        this.startPrice = candle.close;
      }

      this.endPrice = candle.close;

      if (this.openRoundTrip) {
        if (this.roundTrip.entry) {
          const adverse = Big(this.roundTrip.entry.price).minus(candle.close);
          if (adverse.gt(this.maxAdverseExcursion)) {
            this.maxAdverseExcursion = +adverse;
          }
        }
        this.emitRoundtripUpdate();
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
      eventsEmitted: [PERFORMANCE_REPORT_EVENT, ROUNDTRIP_EVENT, ROUNDTRIP_UPDATE_EVENT],
      name: 'PerformanceAnalyzer',
    };
  }
}
