import { Trade } from './trade.types';

export type Batch = {
  amount: number;
  start: EpochTimeStamp;
  end: EpochTimeStamp;
  last: Trade;
  first: Trade;
  data: Trade[];
};
