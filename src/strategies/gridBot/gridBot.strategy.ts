import { ExchangeEvent } from '@models/event.types';
import type { OrderSide } from '@models/order.types';
import type { Portfolio } from '@models/portfolio.types';
import type {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
  Tools,
} from '@strategies/strategy.types';
import type { UUID } from 'node:crypto';
import { DEFAULT_REBALANCE_TOLERANCE_PERCENT, DEFAULT_RETRY_LIMIT, INTERNAL_OPEN_ORDER_CAP } from './gridBot.const';
import type { GridBotStrategyParams, GridMode, LevelState, RebalancePlan, RebalanceStage } from './gridBot.types';
import {
  applyAmountLimits,
  applyCostLimits,
  buildLevelIndexes,
  computeAffordableLevels,
  computeLevelPrice,
  computeRebalancePlan,
  estimatePriceRange,
  inferPricePrecision,
  isGridOutOfRange,
  isOnlyOneSideRemaining,
  resolveLevelQuantity,
  resolveOrderCap,
  roundPrice,
  validateRebalancePlan,
} from './gridBot.utils';

/**
 * GridBot strategy
 *
 * Places a symmetric grid of LIMIT orders centered around the current price.
 * - Buy levels are placed below the center; sell levels above it.
 * - Spacing between levels is configurable: fixed, percent, or geometric/logarithmic multiplier.
 * - When a level is filled, the bot re-arms the adjacent level on the opposite side
 *   (BUY at N -> SELL at N+1, SELL at N -> BUY at N-1) to capture one-step profit.
 * - The number of initially open orders is bounded by a single global cap and portfolio affordability.
 * - Rounds prices to market tick size (price.min) or candle price precision.
 * - If price exits the grid or only one side remains, the bot recenters or not depending on mode.
 * - Order create/cancel operations retry on exchange errors up to a configured limit.
 */
export class GridBot implements Strategy<GridBotStrategyParams> {
  /** Quantity to use per level. */
  private levelQuantity = 0;
  /** Effective open order cap (min of user override and internal cap). */
  private totalOrderCap = INTERNAL_OPEN_ORDER_CAP;
  /** How many times to retry create/cancel on errors. */
  private retryLimit = DEFAULT_RETRY_LIMIT;
  /** Level states indexed by level index. */
  private levelStates = new Map<number, LevelState>();
  private levelIndexes: number[] = [];
  /** Reverse lookup from order id to level index. */
  private orderIdToLevel = new Map<UUID, number>();
  /** Retry counters for order creation and cancellation. */
  private creationRetryCount = new Map<number, number>();
  private cancelRetryCount = new Map<UUID, number>();
  /** Track in-flight cancels during recenter. */
  private pendingCancelIds = new Set<UUID>();
  /** Current grid bounds (min/max price covered by the grid). */
  private gridBounds?: { min: number; max: number };
  private isRecentering = false;
  /** Rebalance configuration */
  private rebalanceEnabled = false;
  private rebalanceTolerance = DEFAULT_REBALANCE_TOLERANCE_PERCENT;
  private awaitingRebalance = false;
  private pendingRebalance?: RebalancePlan;
  private rebalanceOrderId?: UUID;
  private rebalanceRetryCount = 0;

  init({ candle, portfolio, tools }: InitParams<GridBotStrategyParams>): void {
    // Capture and validate parameters; reset state before building the grid
    this.totalOrderCap = resolveOrderCap(tools.strategyParams.totalOpenOrderCap);
    this.retryLimit = Math.max(1, tools.strategyParams.retryOnError ?? DEFAULT_RETRY_LIMIT);
    this.pendingCancelIds.clear();
    this.creationRetryCount.clear();
    this.cancelRetryCount.clear();
    this.orderIdToLevel.clear();
    this.levelStates.clear();
    this.levelIndexes = [];
    this.awaitingRebalance = false;
    this.pendingRebalance = undefined;
    this.rebalanceOrderId = undefined;
    this.rebalanceRetryCount = 0;
    const tolerance = tools.strategyParams.rebalance?.tolerancePercent;
    this.rebalanceTolerance = Number.isFinite(tolerance)
      ? Math.max(0, tolerance ?? DEFAULT_REBALANCE_TOLERANCE_PERCENT)
      : DEFAULT_REBALANCE_TOLERANCE_PERCENT;
    this.rebalanceEnabled = tools.strategyParams.rebalance?.enabled ?? false;

    this.prepareGridBuild('init', candle.close, portfolio, tools);
  }

  /**
   * Check range continuously from the beginning. This keeps behavior consistent
   * across backtests and live, while init() already built the grid at first candle.
   */
  onEachTimeframeCandle({ candle, portfolio, tools }: OnCandleEventParams<GridBotStrategyParams>): void {
    this.checkRangeAndMaybeRecenter(candle.close, portfolio, tools);
  }

  /**
   * On fill, disarm the current level and arm the adjacent opposite level
   * (BUY at N ➜ SELL at N+1, SELL at N ➜ BUY at N−1).
   */
  onOrderCompleted({ order, exchange, tools }: OnOrderCompletedEventParams<GridBotStrategyParams>): void {
    if (this.handleRebalanceOrderCompletion(order.id, exchange.price, exchange.portfolio, tools)) return;

    if (this.pendingCancelIds.has(order.id)) {
      this.pendingCancelIds.delete(order.id);
      this.cancelRetryCount.delete(order.id);
      if (this.pendingCancelIds.size === 0) this.finishRecenterIfNeeded(exchange.price, exchange.portfolio, tools);
      return;
    }

    const levelIndex = this.orderIdToLevel.get(order.id);
    if (levelIndex === undefined) return;

    this.orderIdToLevel.delete(order.id);
    const level = this.levelStates.get(levelIndex);
    if (!level) return;

    level.activeOrderId = undefined;
    level.desiredSide = null;
    this.creationRetryCount.set(levelIndex, 0);

    const neighborIndex = this.findNeighborIndex(levelIndex, order.side === 'BUY' ? 1 : -1, tools.strategyParams.mode);
    if (neighborIndex !== null && this.gridBounds && !isGridOutOfRange(exchange.price, this.gridBounds)) {
      this.scheduleLevel(neighborIndex, order.side === 'BUY' ? 'SELL' : 'BUY', tools);
    }

    this.enforceSideBalance(order.id, exchange, tools);
  }

  /**
   * During recenter: track cancel completions and rebuild once all are done.
   * Otherwise: if level is still desired, re-place the order.
   */
  onOrderCanceled({ order, exchange, tools }: OnOrderCanceledEventParams<GridBotStrategyParams>): void {
    if (this.rebalanceOrderId && order.id === this.rebalanceOrderId) {
      this.handleRebalanceFailure('canceled before completion', tools, exchange.price, exchange.portfolio);
      return;
    }
    if (this.pendingCancelIds.has(order.id)) {
      this.pendingCancelIds.delete(order.id);
      this.cancelRetryCount.delete(order.id);
      if (this.pendingCancelIds.size === 0) this.finishRecenterIfNeeded(exchange.price, exchange.portfolio, tools);
      return;
    }

    const levelIndex = this.orderIdToLevel.get(order.id);
    if (levelIndex === undefined) return;

    const level = this.levelStates.get(levelIndex);
    if (!level) return;

    level.activeOrderId = undefined;

    if (!this.isRecentering && level.desiredSide) {
      this.creationRetryCount.set(levelIndex, 0);
      this.placeOrder(levelIndex, level.desiredSide, tools);
    }
  }

  /** Retry cancel/create up to retryLimit when the exchange returns an error. */
  onOrderErrored({ order, exchange, tools }: OnOrderErroredEventParams<GridBotStrategyParams>): void {
    if (this.rebalanceOrderId && order.id === this.rebalanceOrderId) {
      this.handleRebalanceFailure(order.reason ?? 'rebalance order errored', tools, exchange.price, exchange.portfolio);
      return;
    }
    if (this.pendingCancelIds.has(order.id)) {
      const attempts = (this.cancelRetryCount.get(order.id) ?? 0) + 1;
      if (attempts > this.retryLimit) {
        this.pendingCancelIds.delete(order.id);
        this.cancelRetryCount.delete(order.id);
        tools.log('error', `GridBot cancel retry limit reached for order ${order.id}`);
        if (this.pendingCancelIds.size === 0) {
          this.finishRecenterIfNeeded(exchange.price, exchange.portfolio, tools);
        }
        return;
      }
      this.cancelRetryCount.set(order.id, attempts);
      tools.cancelOrder(order.id);
      return;
    }

    const levelIndex = this.orderIdToLevel.get(order.id);
    if (levelIndex === undefined) return;

    const level = this.levelStates.get(levelIndex);
    this.orderIdToLevel.delete(order.id);
    if (!level || !level.desiredSide) return;

    level.activeOrderId = undefined;
    const attempts = (this.creationRetryCount.get(levelIndex) ?? 0) + 1;
    if (attempts > this.retryLimit) {
      this.creationRetryCount.set(levelIndex, attempts);
      tools.log('error', `GridBot retry limit reached for level ${levelIndex}`);
      return;
    }
    this.creationRetryCount.set(levelIndex, attempts);
    if (!this.isRecentering) this.placeOrder(levelIndex, level.desiredSide, tools);
  }

  onTimeframeCandleAfterWarmup(_params: OnCandleEventParams<GridBotStrategyParams>): void {
    // Not used for this strategy (range checks happen in onEachTimeframeCandle).
  }

  log(_params: OnCandleEventParams<GridBotStrategyParams>): void {
    // Not used for this strategy
  }

  end(): void {
    // Not used for this strategy
  }

  /** Decide whether to rebalance before grid build or build immediately. */
  private prepareGridBuild(
    stage: RebalanceStage,
    currentPrice: number,
    portfolio: Portfolio,
    tools: Tools<GridBotStrategyParams>,
  ) {
    if (this.tryRebalance(stage, currentPrice, portfolio, tools)) return;
    this.rebuildGrid(currentPrice, portfolio, tools);
  }

  /**
   * Attempt to start a rebalance cycle. Returns true when a rebalance order has been placed.
   */
  private tryRebalance(
    stage: RebalanceStage,
    currentPrice: number,
    portfolio: Portfolio,
    tools: Tools<GridBotStrategyParams>,
  ): boolean {
    if (!this.rebalanceEnabled) return false;
    if (stage === 'recenter' && tools.strategyParams.mode === 'oneShot') return false;
    if (this.awaitingRebalance) return true;
    const plan = computeRebalancePlan(stage, currentPrice, portfolio, tools.marketLimits, this.rebalanceTolerance);
    if (!plan) return false;

    if (!validateRebalancePlan(plan, portfolio, tools)) return false;

    this.awaitingRebalance = true;
    this.pendingRebalance = plan;
    this.rebalanceRetryCount = 0;
    this.placeRebalanceOrder(tools);
    return true;
  }

  private placeRebalanceOrder(tools: Tools<GridBotStrategyParams>) {
    if (!this.pendingRebalance) return;
    const {
      side,
      amount,
      stage,
      currentAssetValue,
      currentCurrencyValue,
      targetValuePerSide,
      driftPercent,
      tolerancePercent,
      estimatedNotional,
    } = this.pendingRebalance;
    this.rebalanceOrderId = tools.createOrder({ type: 'STICKY', side, amount });
    tools.log(
      'info',
      [
        `GridBot rebalancing (${stage}):`,
        `asset=${currentAssetValue.toFixed(4)} vs target ${targetValuePerSide.toFixed(4)}`,
        `currency=${currentCurrencyValue.toFixed(4)}`,
        `drift=${driftPercent.toFixed(2)}%`,
        `tolerance=${tolerancePercent}%`,
        `order=${side} STICKY ${amount} (est. ${estimatedNotional.toFixed(4)})`,
      ].join(' '),
    );
  }

  private handleRebalanceOrderCompletion(
    orderId: UUID,
    currentPrice: number,
    portfolio: Portfolio,
    tools: Tools<GridBotStrategyParams>,
  ): boolean {
    if (!this.pendingRebalance || !this.rebalanceOrderId || orderId !== this.rebalanceOrderId) return false;
    this.awaitingRebalance = false;
    this.rebalanceOrderId = undefined;
    this.rebalanceRetryCount = 0;
    const stage = this.pendingRebalance.stage;
    this.pendingRebalance = undefined;
    tools.log('info', `GridBot rebalance (${stage}) completed. Rebuilding grid with updated balances.`);
    this.rebuildGrid(currentPrice, portfolio, tools);
    return true;
  }

  private handleRebalanceFailure(
    reason: string,
    tools: Tools<GridBotStrategyParams>,
    currentPrice?: number,
    portfolio?: Portfolio,
  ) {
    if (!this.pendingRebalance) return;
    const attempts = this.rebalanceRetryCount + 1;
    this.rebalanceRetryCount = attempts;
    this.rebalanceOrderId = undefined;
    if (attempts > this.retryLimit) {
      this.pendingRebalance = undefined;
      this.awaitingRebalance = false;
      tools.log('error', `Rebalance failed: ${reason}`);
      return;
    }
    tools.log('warn', `GridBot rebalance attempt ${attempts} failed (${reason}). Retrying.`);
    if (currentPrice !== undefined && portfolio) {
      // Optionally refresh plan with the latest snapshot.
      const plan = computeRebalancePlan(
        this.pendingRebalance.stage,
        currentPrice,
        portfolio,
        tools.marketLimits,
        this.rebalanceTolerance,
      );
      if (plan && validateRebalancePlan(plan, portfolio, tools)) this.pendingRebalance = plan;
    }
    this.placeRebalanceOrder(tools);
  }

  /**
   * Build/rebuild the grid around the given candle price.
   * 1) Derive precision and round center.
   * 2) Validate spacing/caps; estimate range and derive quantity.
   * 3) Compute affordable levels; create internal level states.
   * 4) Place the initial symmetric BUY/SELL limit orders.
   */
  private rebuildGrid(currentPrice: number, portfolio: Portfolio, tools: Tools<GridBotStrategyParams>) {
    const { strategyParams, marketLimits, log } = tools;
    const { levelsPerSide, levelQuantity, spacingType, spacingValue } = strategyParams;
    const { priceDecimals, priceStep } = inferPricePrecision(currentPrice, marketLimits);
    const centerPrice = roundPrice(currentPrice, priceDecimals, priceStep);

    if (centerPrice <= 0) {
      log('error', 'GridBot cannot initialize with non-positive center price.');
      return;
    }

    if (spacingValue <= 0) {
      log('error', 'GridBot spacingValue must be greater than zero.');
      return;
    }

    const requestedLevels = Math.max(1, Math.floor(levelsPerSide));
    const perSideCap = Math.min(requestedLevels, Math.floor(this.totalOrderCap / 2));
    if (perSideCap <= 0) {
      log('error', 'GridBot open order cap prevents placing any levels.');
      return;
    }

    const rangeEstimate = estimatePriceRange(
      centerPrice,
      perSideCap,
      priceDecimals,
      spacingType,
      spacingValue,
      priceStep,
    );
    if (!rangeEstimate) {
      log('error', 'GridBot could not compute grid range.');
      return;
    }

    let quantity = resolveLevelQuantity(centerPrice, portfolio, perSideCap, marketLimits, levelQuantity);
    quantity = applyAmountLimits(quantity, marketLimits);
    quantity = applyCostLimits(quantity, rangeEstimate.min, rangeEstimate.max, marketLimits);

    if (!quantity || quantity <= 0) {
      log('error', 'GridBot could not derive a valid quantity per level.');
      return;
    }

    const affordableLevels = computeAffordableLevels(
      centerPrice,
      portfolio,
      quantity,
      perSideCap,
      priceDecimals,
      spacingType,
      spacingValue,
      priceStep,
    );
    if (affordableLevels <= 0) {
      log('error', 'GridBot portfolio is insufficient to fund a single grid level.');
      return;
    }

    if (affordableLevels < requestedLevels)
      log(
        'warn',
        `GridBot reduced levelsPerSide from ${requestedLevels} to ${affordableLevels} due to capital or caps.`,
      );

    this.levelQuantity = quantity;
    this.levelIndexes = buildLevelIndexes(affordableLevels);
    this.levelStates.clear();
    this.orderIdToLevel.clear();
    this.creationRetryCount.clear();

    const minPrice = computeLevelPrice(
      centerPrice,
      -affordableLevels,
      priceDecimals,
      spacingType,
      spacingValue,
      priceStep,
    );
    const maxPrice = computeLevelPrice(
      centerPrice,
      affordableLevels,
      priceDecimals,
      spacingType,
      spacingValue,
      priceStep,
    );
    this.gridBounds = { min: minPrice, max: maxPrice };

    for (const index of this.levelIndexes) {
      const price = computeLevelPrice(centerPrice, index, priceDecimals, spacingType, spacingValue, priceStep);
      if (!Number.isFinite(price) || price <= 0) {
        log('warn', `GridBot skipped invalid price for level ${index}.`);
        continue;
      }
      const side: OrderSide | null = index < 0 ? 'BUY' : index > 0 ? 'SELL' : null;
      const level: LevelState = { index, price, desiredSide: side };
      this.levelStates.set(index, level);
    }

    for (const level of this.levelStates.values()) {
      if (level.desiredSide) this.placeOrder(level.index, level.desiredSide, tools);
    }

    log('info', `GridBot initialized around ${centerPrice} with ${affordableLevels} levels/side and qty ${quantity}.`);
  }

  /** Place a LIMIT order for the requested level when allowed by state and caps. */
  private placeOrder(levelIndex: number, side: OrderSide, tools: Tools<GridBotStrategyParams>): UUID | null {
    if (this.isRecentering) return null;
    const level = this.levelStates.get(levelIndex);
    if (!level || level.activeOrderId || level.desiredSide !== side) return level?.activeOrderId ?? null;
    if (this.orderIdToLevel.size >= this.totalOrderCap) return null;

    const orderId = tools.createOrder({ type: 'LIMIT', side, amount: this.levelQuantity, price: level.price });
    level.activeOrderId = orderId;
    this.orderIdToLevel.set(orderId, levelIndex);
    return orderId;
  }

  /** Return adjacent level index or null if out of bounds. */
  private findNeighborIndex(levelIndex: number, offset: 1 | -1, mode: GridMode): number | null {
    const position = this.levelIndexes.indexOf(levelIndex);
    if (position === -1 || (mode === 'recenter' && isOnlyOneSideRemaining(this.levelStates))) return null;
    const neighbor = this.levelIndexes[position + offset];
    return neighbor ?? null;
  }

  /** Recenter or not when the current price exits the grid bounds. */
  private checkRangeAndMaybeRecenter(
    currentPrice: number,
    portfolio: Portfolio,
    tools: Tools<GridBotStrategyParams>,
  ): void {
    if (!this.gridBounds || this.isRecentering || this.awaitingRebalance) return;
    if (!isGridOutOfRange(currentPrice, this.gridBounds)) return;

    const message = `GridBot price ${currentPrice} exited grid range (${this.gridBounds.min} - ${this.gridBounds.max}).`;
    if (tools.strategyParams.mode === 'recenter') this.requestRecenter(currentPrice, portfolio, tools, message);
    else tools.log('warn', message);
  }

  /** Begin recenter: cancel all outstanding orders and rebuild once complete. */
  private requestRecenter(
    currentPrice: number,
    portfolio: Portfolio,
    tools: Tools<GridBotStrategyParams>,
    reason: string,
  ): void {
    if (this.isRecentering || this.awaitingRebalance) return;
    this.isRecentering = true;
    tools.log('info', `GridBot recenter triggered: ${reason}`);
    this.gridBounds = undefined;

    if (this.orderIdToLevel.size === 0) {
      this.finishRecenterIfNeeded(currentPrice, portfolio, tools);
      return;
    }

    this.levelStates.forEach(level => {
      level.desiredSide = null;
      level.activeOrderId = undefined;
    });

    for (const orderId of this.orderIdToLevel.keys()) {
      this.pendingCancelIds.add(orderId);
      tools.cancelOrder(orderId);
    }
    this.orderIdToLevel.clear();
  }

  /** Finalize recentering once all cancels are done, then rebuild the grid. */
  private finishRecenterIfNeeded(currentPrice: number, porfolio: Portfolio, tools: Tools<GridBotStrategyParams>) {
    this.pendingCancelIds.clear();
    this.isRecentering = false;
    this.prepareGridBuild('recenter', currentPrice, porfolio, tools);
  }

  /** Mark a level to host a side and ensure an order is (re)placed for it. */
  private scheduleLevel(levelIndex: number, side: OrderSide, tools: Tools<GridBotStrategyParams>) {
    const level = this.levelStates.get(levelIndex);
    if (!level) return;
    if (level.desiredSide === side && level.activeOrderId) return;
    level.desiredSide = side;
    level.activeOrderId = undefined;
    this.creationRetryCount.set(levelIndex, 0);
    this.placeOrder(levelIndex, side, tools);
  }

  /**
   * If only BUY or only SELL orders remain active, recenter or not according to mode.
   */
  private enforceSideBalance(orderId: UUID, { price, portfolio }: ExchangeEvent, tools: Tools<GridBotStrategyParams>) {
    if (this.isRecentering || this.awaitingRebalance || !isOnlyOneSideRemaining(this.levelStates)) return;
    const message = `[${orderId}] Only one side of the grid remains active.`;
    if (tools.strategyParams.mode === 'recenter') this.requestRecenter(price, portfolio, tools, message);
    else tools.log('warn', message);
  }
}
