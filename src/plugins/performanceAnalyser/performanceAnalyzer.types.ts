import { Portfolio } from '@models/portfolio.types';
import { Nullable } from '@models/utility.types';
import { z } from 'zod';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';

export type PerformanceAnalyzerConfig = z.infer<typeof performanceAnalyzerSchema>;

export type Start = {
  balance: number;
  portfolio: Nullable<Portfolio>;
};

export type DateRange = {
  start: EpochTimeStamp;
  end: EpochTimeStamp;
};

export type Report = {
  startTime: EpochTimeStamp;
  endTime: EpochTimeStamp;
  duration: string;
  market: number;
  balance: number;
  profit: number;
  relativeProfit: number;
  yearlyProfit: number;
  relativeYearlyProfit: number;
  startPrice: number;
  endPrice: number;
  orders: number;
  startBalance: number;
  exposure: number;
  sharpe: number;
  sortino: number;
  /** Standard deviation of balance-change returns */
  standardDeviation: number;
  downside: number;
  alpha: number;
};
