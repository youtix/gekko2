import { TrailingConfig } from '@models/advice.types';
import { TradingPair } from '@models/utility.types';
import { UUID } from 'node:crypto';

export type TrailingStopState = {
  id: UUID;
  symbol: TradingPair;
  /**
   * The amount the BUY filled, as its ORDER_COMPLETED_EVENT reports it, an all-in BUY included: the MARKET SELL the stop sends when
   * triggered sells that amount, not the whole balance.
   */
  amount: number;
  /** The BUY's `trailing`, copied as the stop is armed: a later change to the strategy's object, or to a state's, moves nothing */
  config: TrailingConfig;
  status: 'dormant' | 'active';
  /**
   * The highest price the stop has met while active, 0 until it meets one. The order of a candle's low and high is unknown, so the
   * stop meets a candle's prices as open, low, high, close, testing each against stopPrice before it raises the peak: it triggers on a
   * price the candle reached after the peak whatever that order. The candle that activates a stop with a trigger is met from its open
   * when the open reached the trigger, else from its high, then its close, since its low may have come before the activation.
   */
  highestPeak: number;
  /**
   * highestPeak less config.percentage. A triggered stop reports the peak and the stop price in force when the price reached the
   * stop, not those a later price of the candle would have made.
   */
  stopPrice: number;
  activationPrice?: number;
  createdAt: number;
};
