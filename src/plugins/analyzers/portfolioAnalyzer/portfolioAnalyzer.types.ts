import { EquitySnapshot, Report } from '@models/event.types';
import { Asset } from '@models/utility.types';

export interface PortfolioReport extends Report {
  id: 'PORTFOLIO PROFIT REPORT';
  /** Equity curve: array of snapshots */
  equityCurve: EquitySnapshot[];
  /** Maximum drawdown percentage (peak-to-trough) */
  maxDrawdownPct: number;
  /** Longest drawdown duration in milliseconds */
  longestDrawdownMs: number;
  /** Initial portfolio value in Numéraire */
  startEquity: number;
  /** Final portfolio value in Numéraire */
  endEquity: number;
  /** Total number of portfolio change events */
  portfolioChangeCount: number;
  /** Benchmark asset used for alpha calculation */
  benchmarkAsset: Asset;
}
