import { Report } from '@models/event.types';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { UUID } from 'node:crypto';

export interface TradingReport extends Report {
  /** Percentage of the period spent in round trips, including the one still open at the end */
  exposurePct: number;
  /** Pair equity at the end of the period: the latest portfolio at the last close, a position still open included */
  finalBalance: number;
  /** Type of the report */
  id: 'TRADING REPORT';
  /** Percentage of profitable round-trips relative to total trades (Win Rate) */
  winRate: number | null;
  /** Initial portfolio balance at the start of the period */
  startBalance: number;
  /** List of the top 10 largest Max Adverse Excursions (MAE) encountered */
  topMAEs: number[];
  /** Total number of trades executed during the period: the orders completed, and the canceled ones that filled in part */
  tradeCount: number;
}

/**
 * The pair equity the period starts from, and the portfolio it values. It is the latest portfolio received when the warmup completes,
 * valued at the close of the candle that completed it: the start price, which the market return starts from too. A portfolio
 * received during the warmup must not give it at the price of its own minute: the price moves until the warmup completes, and the
 * return of the run would count that move. Without a portfolio by then, it is the first one received after the warmup, valued at
 * the price known then.
 */
export type Start = {
  equity: number;
  /** Null until the start is taken */
  portfolio: Portfolio | null;
};

/**
 * The round trip in progress, from the BUY that opened it while flat to the SELL that leaves it flat again. The BUYs in between add
 * to its position (scale-in), the SELLs in between reduce it. One still open when the warmup completes is rebased at the start of the
 * period: its entry date, entry price and entry equity become those of the start (see RoundTripAnalyzer.leaveOutWarmupTrading).
 */
export type OpenRoundTrip = {
  /** Execution date of its first BUY */
  entryAt: EpochTimeStamp;
  /** Mean price of its BUYs, weighted by their amounts */
  entryPrice: number;
  /**
   * Pair equity before its first BUY, at the price of that BUY: the pair equity after it plus its fee, which the BUY took from the
   * pair, in currency or in the asset bought. The exit equity is read after the SELL that ends the round trip, its fee paid, so that
   * the pnl and the profit of the round trip are net of the fees of all its orders: those of its later BUYs (scale-in) and of its
   * other SELLs are in the exit equity already. An unknown fee counts as 0 (see Fill).
   */
  entryEquity: number;
  /** Amount of asset its BUYs bought */
  bought: number;
  /** Amount of asset its SELLs have sold so far */
  sold: number;
  /** Mean price of its SELLs so far, weighted by their amounts (0 before the first one) */
  exitPrice: number;
  /** Deepest fall of a candle low below the entry price since it opened, in % of the entry price, measured after the warmup only */
  maxAdverseExcursion: number;
};

/** What an order filled, as the Trader reports it: a completed order, or the part of a canceled one that filled */
export type OrderFill = {
  id: UUID;
  side: OrderSide;
  /** When it filled: the execution date of a completed order, the cancelation date of a canceled one */
  date: EpochTimeStamp;
  /** Missing, or NaN, when neither the exchange nor the Trader knows it */
  price?: number;
  amount: number;
  /** Its fee in currency, NaN when unknown */
  fee: number;
};

/** An order fill with a valid price and amount, and the pair equity right after it, at its price (see registerRoundtripPart) */
export type Fill = {
  date: EpochTimeStamp;
  price: number;
  amount: number;
  /** Its fee in currency, 0 when unknown */
  fee: number;
  equity: number;
};

export type DateRange = {
  start: EpochTimeStamp;
  end: EpochTimeStamp;
};
