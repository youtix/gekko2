import { Portfolio } from '@models/portfolio.types';
import { Nullable } from '@models/utility.types';
import Yup from 'yup';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';

export type PerformanceAnalyzerConfig = Yup.InferType<typeof performanceAnalyzerSchema>;

export type Start = {
  balance: number;
  portfolio: Nullable<Portfolio>;
};

export type SingleRoundTrip = {
  id: number;
  exit: Nullable<RoundTripData>;
  entry: Nullable<RoundTripData>;
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
  trades: number;
  startBalance: number;
  exposure: number;
  sharpe: number;
  /** Standard deviation of roundtrip profits */
  standardDeviation: number;
  downside: number;
  ratioRoundTrips: Nullable<number>;
  /**
   * Maximum adverse excursion observed across all closed roundtrips.
   * Expressed as a percentage.
   */
  worstMaxAdverseExcursion: number;
  alpha: number;
};
