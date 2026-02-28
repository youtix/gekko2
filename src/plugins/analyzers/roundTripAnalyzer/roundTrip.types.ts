import { Report } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';

export interface TradingReport extends Report {
  /** Percentage of time the portfolio was exposed to market risk */
  exposurePct: number;
  /** Final portfolio balance at the end of the period */
  finalBalance: number;
  /** Type of the report */
  id: 'TRADING REPORT';
  /** Percentage of profitable round-trips relative to total trades (Win Rate) */
  winRate: number | null;
  /** Initial portfolio balance at the start of the period */
  startBalance: number;
  /** List of the top 10 largest Max Adverse Excursions (MAE) encountered */
  topMAEs: number[];
  /** Total number of trades executed during the period */
  tradeCount: number;
}

export type Start = {
  equity: number;
  portfolio: Portfolio | null;
};

export type SingleRoundTrip = {
  exit: RoundTripData | null;
  entry: RoundTripData | null;
};

export type DateRange = {
  start: EpochTimeStamp;
  end: EpochTimeStamp;
};

export type RoundTripData = {
  price: number;
  date: number;
  total: number;
  asset: number;
  currency: number;
};
