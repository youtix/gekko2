import { OrderSide } from '@models/order.types';
import { UUID } from 'node:crypto';

/** Spacing type options for grid level distribution */
export type GridSpacingType = 'percent' | 'fixed' | 'logarithmic';

/** Strategy configuration parameters */
export interface GridBotStrategyParams {
  /** Number of buy levels below center price */
  buyLevels: number;
  /** Number of sell levels above center price */
  sellLevels: number;
  /** How levels are spaced apart */
  spacingType: GridSpacingType;
  /**
   * Distance between levels:
   * - percent: expressed in percent (1 === 1%)
   * - fixed: price units
   * - logarithmic: multiplier increment (0.01 === +1% per hop)
   */
  spacingValue: number;
  /** Number of order creation/cancel retries before logging error */
  retryOnError?: number;
}

/** State of a single grid level */
export interface LevelState {
  /** Level index (negative for buy, positive for sell) */
  index: number;
  /** Price at this level */
  price: number;
  /** Order side for this level */
  side: OrderSide;
  /** Active order ID if order is placed */
  orderId?: UUID;
}

/** Grid price boundaries */
export interface GridBounds {
  /** Lowest grid price (bottom buy level) */
  min: number;
  /** Highest grid price (top sell level) */
  max: number;
}

/** Rebalance plan computed during init */
export interface RebalancePlan {
  /** Side of rebalance order */
  side: OrderSide;
  /** Amount to trade */
  amount: number;
  /** Estimated notional value */
  estimatedNotional: number;
  /** Current center price used for calculation */
  centerPrice: number;
}
