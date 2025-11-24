import { OrderSide } from '@models/order.types';
import { UUID } from 'node:crypto';

export type GridSpacingType = 'percent' | 'fixed' | 'geometric' | 'logarithmic';
export type GridMode = 'recenter' | 'oneShot';
export type RebalanceStage = 'init' | 'recenter';

export interface GridRange {
  min: number;
  max: number;
}

/** State for a single grid level (index relative to the center). */
export interface LevelState {
  index: number;
  price: number;
  desiredSide: OrderSide | null;
  activeOrderId?: UUID;
}

export interface GridBotRebalanceParams {
  /** Enable 50/50 portfolio rebalance before constructing a grid */
  enabled?: boolean;
  /** Drift threshold (% of portfolio value) before triggering a rebalance */
  tolerancePercent?: number;
}

export interface GridBotStrategyParams {
  /** How many buy levels below and sell levels above the center price */
  levelsPerSide: number;
  /** Shape of the spacing between consecutive levels */
  spacingType: GridSpacingType;
  /**
   * Distance between levels.
   * - percent => expressed in percent (1 === 1%)
   * - fixed => price units
   * - geometric/logarithmic => multiplier increment (0.01 === +1% per hop)
   */
  spacingValue: number;
  /** Fixed quantity per level (optional). When omitted, quantity is inferred from balances. */
  levelQuantity?: number;
  /** Choose mode once the price leaves the grid. */
  mode: GridMode;
  /**
   * Optional override for the global open-order cap. Shared by both sides, still
   * bounded by the internal ceiling.
   */
  totalOpenOrderCap?: number;
  /** Number of order creation/cancel retries before to log error */
  retryOnError?: number;
  /** Optional configuration for pre-grid rebalancing */
  rebalance?: GridBotRebalanceParams;
}

export interface RebalancePlan {
  stage: RebalanceStage;
  side: OrderSide;
  amount: number;
  centerPrice: number;
  driftPercent: number;
  tolerancePercent: number;
  targetValuePerSide: number;
  currentAssetValue: number;
  currentCurrencyValue: number;
  estimatedNotional: number;
}
