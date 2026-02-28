export interface EMARibbonStrategyParams {
  /** Source of the EMA ribbon */
  src: 'close' | 'ohlc4';
  /** Number of EMAs */
  count: number;
  /** Starting EMA period */
  start: number;
  /** Step between EMAs */
  step: number;
  /** Spread compression threshold */
  spreadCompressionThreshold: number;
}
