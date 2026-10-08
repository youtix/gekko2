import { WilderSmoothing } from '../wilderSmoothing/wilderSmoothing.indicator';

/**
 * The smoothed moving average is Wilder's smoothing under another name. It used to be a second copy of the same recurrence,
 * seeded through an SMA, so the two could drift apart; it now is that class and only declares its own input.
 */
export class SMMA extends WilderSmoothing {
  /** Only narrows the type: SMMA declares its period as required, WilderSmoothing as optional with a default of 14 */
  constructor(parameters: IndicatorRegistry['SMMA']['input']) {
    super(parameters);
  }
}
