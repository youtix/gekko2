import { Nullable } from '@models/types/generic.types';
import { Portfolio } from '@models/types/portfolio.types';
import Yup from 'yup';
import { performanceAnalyzerSchema } from './performanceAnalyzer.schema';

export type PerformanceAnalyzerConfig = Yup.InferType<typeof performanceAnalyzerSchema>;

export type Start = {
  balance: number;
  portfolio?: Portfolio;
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
  downside: number;
  ratioRoundTrips: number;
  /**
   * Maximum adverse excursion observed across all closed roundtrips.
   */
  worstMaxAdverseExcursion: number;
  alpha: number;
};
