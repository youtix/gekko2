export type Candle = {
  id?: number;
  start: EpochTimeStamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Set on a candle made up by the gap filler for a minute the exchange did not deliver (flat at the last close, volume 0) */
  synthetic?: true;
};
