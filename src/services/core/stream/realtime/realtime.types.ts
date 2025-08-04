export type RealtimeStreamInput = {
  /** The tickrate in milliseconds, which determines how often the stream should emit events. Default is 10 seconds if not provided. */
  tickrate: number;
};
