import { OrderSide } from '@models/order.types';
import { UUID } from 'node:crypto';
import { z } from 'zod';
import { gridBotStrategySchema } from './gridBot.schema';

/** Strategy configuration parameters: the output of GridBot.schema, retryOnError defaulted */
export type GridBotStrategyParams = z.infer<typeof gridBotStrategySchema>;

/** Spacing type options for grid level distribution */
export type GridSpacingType = GridBotStrategyParams['spacingType'];

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

/** Rebalance plan, computed when the grid starts, after the warmup (and again after a failed attempt) */
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
