export type Candle = {
  id?: number;
  start: EpochTimeStamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
