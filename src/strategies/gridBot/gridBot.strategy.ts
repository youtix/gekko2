import type { OrderSide } from '@models/order.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
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
import { DEFAULT_RETRY_LIMIT } from './gridBot.const';
import type { GridBotStrategyParams, GridBounds, LevelState, RebalancePlan } from './gridBot.types';
import {
  computeGridBounds,
  computeLevelPrice,
  computeRebalancePlan,
  deriveLevelQuantity,
  getPortfolioContent,
  hasOnlyOneSide,
  inferPricePrecision,
  isOutOfRange,
  roundPrice,
  validateConfig,
} from './gridBot.utils';

/**
 * GridBot Strategy
 *
 * Places a grid of LIMIT orders around the current price.
 * - Buy levels are placed below the center price
 * - Sell levels are placed above the center price
 * - Spacing between levels is configurable: fixed, percent, or logarithmic
 * - When a level is filled, the bot arms the adjacent opposite side level
 * - Mandatory rebalancing ensures 50/50 portfolio allocation before grid building
 * - On exchange errors, orders are retried up to the configured limit
 * - When price exits the grid range, a warning is logged but trading continues
 */
export class GridBot implements Strategy<GridBotStrategyParams> {
  /** Base asset */
  private base: string = '';
  /** Quote asset */
  private quote: string = '';
  /** Trading pair */
  private pair: TradingPair = '/';
  /** All grid levels with their state */
  private levels: LevelState[] = [];
  /** Grid price boundaries */
  private gridBounds?: GridBounds;
  /** Quantity per level */
  private quantity = 0;
  /** Retry limit for order operations */
  private retryLimit = DEFAULT_RETRY_LIMIT;
  /** Retry counts per level index */
  private retryCount = new Map<number, number>();
  /** Reverse lookup: order ID to level index */
  private orderToLevel = new Map<UUID, number>();

  // Rebalance state
  private awaitingRebalance = false;
  private pendingRebalance?: RebalancePlan;
  private rebalanceOrderId?: UUID;
  private rebalanceRetryCount = 0;

  // Cached price precision
  private priceDecimals = 2;
  private priceStep?: number;

  init({ candle, portfolio, tools }: InitParams<GridBotStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    const [base, quote] = pair.split('/');
    this.base = base;
    this.quote = quote;
    this.reset();
    this.retryLimit = Math.max(1, tools.strategyParams.retryOnError ?? DEFAULT_RETRY_LIMIT);

    const { priceDecimals, priceStep } = inferPricePrecision(candle.get(this.pair)!.close, tools.marketData.get(this.pair)!);
    this.priceDecimals = priceDecimals;
    this.priceStep = priceStep;

    const centerPrice = roundPrice(candle.get(this.pair)!.close, priceDecimals, priceStep);

    // Validate configuration
    const validationError = validateConfig(tools.strategyParams, centerPrice, tools.marketData.get(this.pair)!);
    if (validationError) {
      tools.log('error', `GridBot: ${validationError}`);
      return;
    }

    // Always attempt rebalancing first
    this.prepareGrid(centerPrice, portfolio, tools);
  }

  onEachTimeframeCandle({ candle, tools }: OnCandleEventParams<GridBotStrategyParams>): void {
    if (!this.gridBounds || this.awaitingRebalance) return;
    const close = candle.get(this.pair)!.close;

    if (isOutOfRange(close, this.gridBounds)) {
      tools.log('warn', `GridBot: Price ${close} is out of grid range [${this.gridBounds.min}, ${this.gridBounds.max}]`);
    }
  }

  onTimeframeCandleAfterWarmup(_params: OnCandleEventParams<GridBotStrategyParams>): void {
    // Range checks happen in onEachTimeframeCandle
  }

  onOrderCompleted({ order, exchange, tools }: OnOrderCompletedEventParams<GridBotStrategyParams>): void {
    // Handle rebalance order completion
    const { asset, currency } = getPortfolioContent(exchange.portfolio, this.base, this.quote);
    if (this.handleRebalanceCompletion(order.id, exchange.price, asset.free, currency.free, tools)) {
      return;
    }

    // Handle grid order completion
    const levelIndex = this.orderToLevel.get(order.id);
    if (levelIndex === undefined) return;

    this.orderToLevel.delete(order.id);
    const level = this.levels[levelIndex];
    if (!level) return;

    // Clear this level
    level.orderId = undefined;
    this.retryCount.delete(levelIndex);

    // Arm the adjacent opposite side level
    const neighborIndex = order.side === 'BUY' ? levelIndex + 1 : levelIndex - 1;
    const neighborSide: OrderSide = order.side === 'BUY' ? 'SELL' : 'BUY';

    if (neighborIndex >= 0 && neighborIndex < this.levels.length) {
      const neighbor = this.levels[neighborIndex];
      if (neighbor && !neighbor.orderId) {
        this.placeOrder(neighborIndex, neighborSide, tools);
      }
    }

    // Check if only one side remains
    if (hasOnlyOneSide(this.levels)) {
      tools.log('warn', 'GridBot: Only one side of the grid remains active');
    }
  }

  onOrderCanceled({ order, exchange, tools }: OnOrderCanceledEventParams<GridBotStrategyParams>): void {
    // Handle rebalance order cancellation
    if (this.rebalanceOrderId && order.id === this.rebalanceOrderId) {
      const { asset, currency } = getPortfolioContent(exchange.portfolio, this.base, this.quote);
      this.handleRebalanceFailure('Order was canceled', exchange.price, asset, currency, tools);
      return;
    }

    // Handle grid order cancellation - try to replace it
    const levelIndex = this.orderToLevel.get(order.id);
    if (levelIndex === undefined) return;

    this.orderToLevel.delete(order.id);
    const level = this.levels[levelIndex];
    if (!level) return;

    level.orderId = undefined;

    // Re-place the order if we're not in rebalancing mode
    if (!this.awaitingRebalance) {
      this.retryCount.set(levelIndex, 0);
      this.placeOrder(levelIndex, level.side, tools);
    }
  }

  onOrderErrored({ order, exchange, tools }: OnOrderErroredEventParams<GridBotStrategyParams>): void {
    // Handle rebalance order error
    if (this.rebalanceOrderId && order.id === this.rebalanceOrderId) {
      const { asset, currency } = getPortfolioContent(exchange.portfolio, this.base, this.quote);
      this.handleRebalanceFailure(order.reason ?? 'Unknown error', exchange.price, asset, currency, tools);
      return;
    }

    // Handle grid order error
    const levelIndex = this.orderToLevel.get(order.id);
    if (levelIndex === undefined) return;

    this.orderToLevel.delete(order.id);
    const level = this.levels[levelIndex];
    if (!level) return;

    level.orderId = undefined;

    // Retry if under the limit
    const attempts = (this.retryCount.get(levelIndex) ?? 0) + 1;
    if (attempts > this.retryLimit) {
      tools.log('error', `GridBot: Retry limit reached for level ${levelIndex}`);
      return;
    }

    this.retryCount.set(levelIndex, attempts);
    this.placeOrder(levelIndex, level.side, tools);
  }

  log(_params: OnCandleEventParams<GridBotStrategyParams>): void {
    // No logging implementation needed
  }

  end(): void {
    // No cleanup needed
  }

  /** Reset all internal state */
  private reset(): void {
    this.levels = [];
    this.gridBounds = undefined;
    this.quantity = 0;
    this.retryCount.clear();
    this.orderToLevel.clear();
    this.awaitingRebalance = false;
    this.pendingRebalance = undefined;
    this.rebalanceOrderId = undefined;
    this.rebalanceRetryCount = 0;
  }

  /** Check if rebalancing is needed and initiate it, or build grid directly */
  private prepareGrid(centerPrice: number, portfolio: Portfolio, tools: Tools<GridBotStrategyParams>): void {
    const { buyLevels, sellLevels } = tools.strategyParams;
    const { asset, currency } = getPortfolioContent(portfolio, this.base, this.quote);
    const marketData = tools.marketData.get(this.pair)!;
    const plan = computeRebalancePlan(centerPrice, asset.total, currency.total, buyLevels, sellLevels, marketData);

    if (plan) {
      // Validate rebalance is possible
      if (plan.side === 'SELL' && plan.amount > asset.free) {
        tools.log('warn', 'GridBot: Insufficient asset for rebalance, building grid with current allocation');
        this.buildGrid(centerPrice, asset.free, currency.free, tools);
        return;
      }
      if (plan.side === 'BUY' && plan.estimatedNotional > currency.free) {
        tools.log('warn', 'GridBot: Insufficient currency for rebalance, building grid with current allocation');
        this.buildGrid(centerPrice, asset.free, currency.free, tools);
        return;
      }

      this.awaitingRebalance = true;
      this.pendingRebalance = plan;
      this.rebalanceRetryCount = 0;
      this.placeRebalanceOrder(tools);
    } else {
      this.buildGrid(centerPrice, asset.free, currency.free, tools);
    }
  }

  /** Place the rebalance STICKY order */
  private placeRebalanceOrder(tools: Tools<GridBotStrategyParams>): void {
    if (!this.pendingRebalance) return;

    const { side, amount } = this.pendingRebalance;
    this.rebalanceOrderId = tools.createOrder({ type: 'STICKY', side, amount, symbol: this.pair });
    tools.log('info', `GridBot: Rebalancing - ${side} ${amount} (STICKY order)`);
  }

  /** Handle successful rebalance order completion */
  private handleRebalanceCompletion(
    orderId: UUID,
    currentPrice: number,
    assetFree: number,
    currencyFree: number,
    tools: Tools<GridBotStrategyParams>,
  ): boolean {
    if (!this.pendingRebalance || this.rebalanceOrderId !== orderId) return false;

    this.awaitingRebalance = false;
    this.rebalanceOrderId = undefined;
    this.rebalanceRetryCount = 0;
    this.pendingRebalance = undefined;

    tools.log('info', 'GridBot: Rebalance complete, building grid');

    const centerPrice = roundPrice(currentPrice, this.priceDecimals, this.priceStep);
    this.buildGrid(centerPrice, assetFree, currencyFree, tools);

    return true;
  }

  /** Handle rebalance order failure */
  private handleRebalanceFailure(
    reason: string,
    currentPrice: number,
    asset: BalanceDetail,
    currency: BalanceDetail,
    tools: Tools<GridBotStrategyParams>,
  ): void {
    this.rebalanceRetryCount++;
    this.rebalanceOrderId = undefined;

    if (this.rebalanceRetryCount > this.retryLimit) {
      tools.log('error', `GridBot: Rebalance failed after ${this.retryLimit} attempts: ${reason}`);
      this.awaitingRebalance = false;
      this.pendingRebalance = undefined;

      // Build grid anyway with current allocation
      const centerPrice = roundPrice(currentPrice, this.priceDecimals, this.priceStep);
      this.buildGrid(centerPrice, asset.free, currency.free, tools);
      return;
    }

    tools.log('warn', `GridBot: Rebalance attempt ${this.rebalanceRetryCount} failed: ${reason}. Retrying...`);

    const marketData = tools.marketData.get(this.pair)!;

    // Refresh the rebalance plan with current portfolio
    const { buyLevels, sellLevels } = tools.strategyParams;
    const plan = computeRebalancePlan(currentPrice, asset.free, currency.free, buyLevels, sellLevels, marketData);
    if (plan) {
      this.pendingRebalance = plan;
      this.placeRebalanceOrder(tools);
    } else {
      // No longer needs rebalancing
      this.awaitingRebalance = false;
      this.pendingRebalance = undefined;
      const centerPrice = roundPrice(currentPrice, this.priceDecimals, this.priceStep);
      this.buildGrid(centerPrice, asset.free, currency.free, tools);
    }
  }

  /** Build the grid around the center price */
  private buildGrid(centerPrice: number, assetFree: number, currencyFree: number, tools: Tools<GridBotStrategyParams>): void {
    const { buyLevels, sellLevels, spacingType, spacingValue } = tools.strategyParams;

    const marketData = tools.marketData.get(this.pair)!;

    // Compute grid bounds
    const bounds = computeGridBounds(centerPrice, buyLevels, sellLevels, this.priceDecimals, spacingType, spacingValue, this.priceStep);

    if (!bounds) {
      tools.log('error', 'GridBot: Could not compute valid grid bounds');
      return;
    }

    this.gridBounds = bounds;

    // Derive quantity per level
    this.quantity = deriveLevelQuantity(
      centerPrice,
      assetFree,
      currencyFree,
      buyLevels,
      sellLevels,
      this.priceDecimals,
      spacingType,
      spacingValue,
      marketData,
      this.priceStep,
    );

    if (this.quantity <= 0) {
      tools.log('error', 'GridBot: Insufficient portfolio for any grid levels');
      return;
    }

    // Build level states
    this.levels = [];
    this.orderToLevel.clear();
    this.retryCount.clear();

    // Create buy levels (negative indices, stored first)
    for (let i = buyLevels; i >= 1; i--) {
      const price = computeLevelPrice(centerPrice, -i, this.priceDecimals, spacingType, spacingValue, this.priceStep);
      if (price > 0) {
        this.levels.push({ index: -i, price, side: 'BUY' });
      }
    }

    // Create sell levels (positive indices)
    for (let i = 1; i <= sellLevels; i++) {
      const price = computeLevelPrice(centerPrice, i, this.priceDecimals, spacingType, spacingValue, this.priceStep);
      if (price > 0) {
        this.levels.push({ index: i, price, side: 'SELL' });
      }
    }

    // Place initial orders
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      this.placeOrder(i, level.side, tools);
    }

    tools.log('info', `GridBot: Grid built around ${centerPrice} with ${buyLevels} buy / ${sellLevels} sell levels, qty=${this.quantity}`);
  }

  /** Place a LIMIT order for a level */
  private placeOrder(levelArrayIndex: number, side: OrderSide, tools: Tools<GridBotStrategyParams>): void {
    const level = this.levels[levelArrayIndex];
    if (!level || level.orderId) return;

    const orderId = tools.createOrder({
      type: 'LIMIT',
      side,
      amount: this.quantity,
      price: level.price,
      symbol: this.pair,
    });

    level.orderId = orderId;
    this.orderToLevel.set(orderId, levelArrayIndex);
  }
}
