import { GekkoError } from '@errors/gekko.error';
import type { OrderSide } from '@models/order.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import {
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
import { gridBotStrategySchema } from './gridBot.schema';
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
 * - The grid is placed on the first timeframe candle after the warmup, centred on its close
 * - Buy levels are placed below the center price
 * - Sell levels are placed above the center price
 * - Spacing between levels is configurable: fixed, percent, or logarithmic
 * - Each level trades back and forth between two adjacent prices of the grid: once its BUY fills it sells one step above, once its
 *   SELL fills it buys one step below
 * - Mandatory rebalancing ensures 50/50 portfolio allocation before grid building
 * - A failed order is placed again up to retryOnError times. Then a grid order is left out with a warning, the rest of the grid
 *   trading on until no level holds an order, and a rebalance stops the run
 * - When price exits the grid range, a warning is logged but trading continues
 */
export class GridBot implements Strategy<GridBotStrategyParams> {
  /** Parses the strategy block before the strategy is created: tools.strategyParams is its output */
  static schema = gridBotStrategySchema;

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
  /** Set by the first candle after the warmup, which starts the grid: it is started once, whatever the outcome */
  private isGridStarted = false;

  // Rebalance state
  private awaitingRebalance = false;
  private pendingRebalance?: RebalancePlan;
  private rebalanceOrderId?: UUID;
  private rebalanceRetryCount = 0;

  // Cached price precision
  private priceDecimals = 2;
  private priceStep?: number;

  /** Reads the pair and the parameters only: the grid is started by the first candle after the warmup */
  init({ candle, tools }: InitParams<GridBotStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    const [base, quote] = pair.split('/');
    this.base = base;
    this.quote = quote;
    this.reset();
    this.retryLimit = tools.strategyParams.retryOnError;
  }

  onEachTimeframeCandle({ candle, tools }: OnCandleEventParams<GridBotStrategyParams>): void {
    if (!this.gridBounds || this.awaitingRebalance) return;
    const close = candle.get(this.pair)!.close;

    if (isOutOfRange(close, this.gridBounds)) {
      tools.log('warn', `GridBot: Price ${close} is out of grid range [${this.gridBounds.min}, ${this.gridBounds.max}]`);
    }
  }

  /**
   * Starts the grid, once, around the close of the first candle after the warmup: a rebalance first if the portfolio needs one.
   * Started from init, the grid was centred on the first candle of the warmup: in realtime a candle of the history replayed at
   * start-up, a year old with 365 daily candles, and the Trader sent that grid live, so the levels the market had moved past
   * executed at once; in a backtest it traded through the warmup.
   */
  onTimeframeCandleAfterWarmup({ candle, portfolio, tools }: OnCandleEventParams<GridBotStrategyParams>): void {
    if (this.isGridStarted) return;
    this.isGridStarted = true;

    const close = candle.get(this.pair)!.close;
    const marketData = tools.marketData.get(this.pair)!;
    const { priceDecimals, priceStep } = inferPricePrecision(close, marketData);
    this.priceDecimals = priceDecimals;
    this.priceStep = priceStep;

    const centerPrice = roundPrice(close, priceDecimals, priceStep);

    const validationError = validateConfig(tools.strategyParams, centerPrice, marketData);
    if (validationError) this.stopRun(validationError, tools);

    // Always attempt rebalancing first
    this.prepareGrid(centerPrice, portfolio, tools);
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

    // The level that filled turns to the other side, one step away: a SELL above the BUY, a BUY below the SELL. A fill used to arm
    // the neighbouring level, and only if it held no order: a neighbour whose own fill was not reported yet was skipped, so a drop
    // through several BUYs re-armed when a backtest reported them highest first but not when paper or live trading polled them lowest
    // first, and the two levels next to the center price, each the other's neighbour, armed nothing on their first fill.
    this.placeOrder(levelIndex, level.side === 'BUY' ? 'SELL' : 'BUY', tools);

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
      this.giveUpLevel(level, attempts, order.reason, tools);
      return;
    }

    this.retryCount.set(levelIndex, attempts);
    this.placeOrder(levelIndex, level.side, tools);
  }

  /** Reset all internal state */
  private reset(): void {
    this.isGridStarted = false;
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

    // A rebalance that failed at every attempt stops the run. A grid used to follow, built anyway on the portfolio as it was, after a
    // tools.log('error') that had already thrown: it never ran. Not rebalanced, the portfolio would size every level on its scarcer
    // side, the rest left idle, or fund none.
    if (this.rebalanceRetryCount > this.retryLimit) {
      const failure = `Rebalance failed after ${this.rebalanceRetryCount} attempts (retryOnError: ${this.retryLimit})`;
      this.stopRun(`${failure}: the grid is not built. Last error: ${reason}`, tools);
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
    if (!bounds) this.stopRun('Could not compute valid grid bounds', tools);

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

    if (this.quantity <= 0) this.stopRun('Insufficient portfolio for any grid levels', tools);

    // Build level states, each between two adjacent prices of the grid, the center price being the top of level -1 and the bottom
    // of level 1
    this.levels = [];
    this.orderToLevel.clear();
    this.retryCount.clear();
    const priceAt = (steps: number) => computeLevelPrice(centerPrice, steps, this.priceDecimals, spacingType, spacingValue, this.priceStep);

    // Create buy levels (negative indices, stored first), which start with their BUY
    for (let i = buyLevels; i >= 1; i--) {
      const buyPrice = priceAt(-i);
      if (buyPrice > 0) {
        this.levels.push({ index: -i, buyPrice, sellPrice: priceAt(1 - i), side: 'BUY' });
      }
    }

    // Create sell levels (positive indices), which start with their SELL
    for (let i = 1; i <= sellLevels; i++) {
      const sellPrice = priceAt(i);
      if (sellPrice > 0) {
        this.levels.push({ index: i, buyPrice: priceAt(i - 1), sellPrice, side: 'SELL' });
      }
    }

    // Place initial orders
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      this.placeOrder(i, level.side, tools);
    }

    tools.log('info', `GridBot: Grid built around ${centerPrice} with ${buyLevels} buy / ${sellLevels} sell levels, qty=${this.quantity}`);
  }

  /** Place a LIMIT order for a level, at its buy or sell price: the level takes the side of the order */
  private placeOrder(levelArrayIndex: number, side: OrderSide, tools: Tools<GridBotStrategyParams>): void {
    const level = this.levels[levelArrayIndex];
    if (!level || level.orderId) return;

    const orderId = tools.createOrder({
      type: 'LIMIT',
      side,
      amount: this.quantity,
      price: side === 'BUY' ? level.buyPrice : level.sellPrice,
      symbol: this.pair,
    });

    // A fill turns its level to the other side. The level used to keep the side the grid was built with, so a canceled or errored
    // order a fill had armed came back on the other side: a BUY above the market or a SELL below it, which executed at once or,
    // unfunded, was refused on every retry. The one-side warning read the same stale sides.
    level.orderId = orderId;
    level.side = side;
    this.orderToLevel.set(orderId, levelArrayIndex);
  }

  /**
   * Leaves a level without an order once its order failed at every attempt, the first and retryOnError retries: the rest of the grid
   * trades on, and the run stops once no level holds an order. A level used to give up through tools.log('error'), which throws: the
   * first one to give up stopped the bot, with a message naming an array index rather than the order.
   */
  private giveUpLevel(level: LevelState, attempts: number, reason: string, tools: Tools<GridBotStrategyParams>): void {
    const price = level.side === 'BUY' ? level.buyPrice : level.sellPrice;
    const failure = `${level.side} at ${price} failed after ${attempts} attempts (retryOnError: ${this.retryLimit})`;
    if (this.levels.every(({ orderId }) => !orderId))
      this.stopRun(`${failure}: no level of the grid holds an order any more. Last error: ${reason}`, tools);
    tools.log('warn', `GridBot: ${failure}: its level is left without an order, the rest of the grid trades on. Last error: ${reason}`);
  }

  /**
   * Stops the run with the message, logged and relayed at error level: tools.log('error') throws a GekkoError. GridBot places its
   * grid once, so a grid it cannot place, or one without any order left, would leave it idle for the rest of the run.
   */
  private stopRun(message: string, tools: Tools<GridBotStrategyParams>): never {
    tools.log('error', `GridBot: ${message}`);
    // Not reached, tools.log('error') throwing first: it makes the stop explicit, to the compiler and with a log that would return
    throw new GekkoError('strategy', `GridBot: ${message}`);
  }
}
