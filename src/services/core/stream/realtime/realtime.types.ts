export type RealtimeStreamInput = {
  /** The tickrate in seconds, which determines how often the stream should emit events. Default is 10 seconds if not provided. */
  tickrate?: number;

  /** The threshold used to filter trades before to batch them (timestamp milliseconds). Default is 0 (no threshold). */
  threshold?: EpochTimeStamp;
};
