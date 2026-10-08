import { OrderSide } from '@models/order.types';
import { UUID } from 'node:crypto';
import { z } from 'zod';
import { gridBotStrategySchema } from './gridBot.schema';

/** Strategy configuration parameters: the output of GridBot.schema, retryOnError defaulted */
export type GridBotStrategyParams = z.infer<typeof gridBotStrategySchema>;

/** Spacing type options for grid level distribution */
export type GridSpacingType = GridBotStrategyParams['spacingType'];

/**
 * State of a single grid level: two adjacent prices of the grid, between which the level trades its quantity back and forth with
 * one order at a time, a BUY at the lower price or a SELL at the upper one. The two levels next to the center price share it.
 */
export interface LevelState {
  /** Level index: negative below the center price, positive above */
  index: number;
  /** Lower price of the level, where it buys */
  buyPrice: number;
  /** Upper price of the level, where it sells */
  sellPrice: number;
  /**
   * Side of the order placed last on the level, the live one while orderId is set. A level below the center price starts with its
   * BUY, a level above it with its SELL, and each fill turns the level to the other side.
   */
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
