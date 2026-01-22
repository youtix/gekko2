export type Candle = {
  id: number | undefined;
  start: EpochTimeStamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
