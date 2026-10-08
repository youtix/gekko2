import { OrderSide } from '@models/order.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { addPrecise } from '@utils/math/math.utils';
import { round } from '@utils/math/round.utils';
import { DEFAULT_AMOUNT_PRECISION, DEFAULT_PRICE_PRECISION, EMPTY_BALANCE } from './gridBot.const';
import { GridBotStrategyParams, GridBounds, GridSize, GridSpacingType, RebalancePlan } from './gridBot.types';

export const getPortfolioContent = (
  portfolio: Portfolio,
  base: string,
  quote: string,
): { asset: BalanceDetail; currency: BalanceDetail } => {
  const asset = portfolio.get(base) ?? { ...EMPTY_BALANCE };
  const currency = portfolio.get(quote) ?? { ...EMPTY_BALANCE };
  return { asset, currency };
};

/**
 * The maker fee of the market, a fraction (0.001 is 0.1 %), which a LIMIT order pays: the grid's orders and the STICKY rebalance's.
 * The simulator of backtests and paper trading charges it in currency, on top of a BUY (DummyCentralizedExchange.getLimitBuyCost) and
 * out of a SELL's proceeds: a BUY of `amount` at `price` needs amount × price × (1 + fee) of free currency, a SELL only its amount of
 * the asset. A live exchange that takes a BUY's fee from the asset bought, as Binance does, leaves what is set aside for it free. A
 * market that states no maker fee is taken to charge none, as the simulator takes it.
 */
export const getMakerFee = (marketData: MarketData): number => marketData.fee?.maker ?? 0;

/**
 * The price the rebalance order, planned at `price`, is placed at: GridBot places it as a STICKY order, which StickyOrder prices one
 * minimum price (price.min) above the bid for a BUY, below the ask for a SELL, the bid and the ask being that price here.
 */
export const getRebalanceOrderPrice = (side: OrderSide, price: number, marketData: MarketData): number => {
  const minimumPrice = marketData.price?.min ?? 0;
  return side === 'BUY' ? price + minimumPrice : price - minimumPrice;
};

/**
 * What a rebalance BUY of `amount`, planned at `price`, takes from the free currency: its STICKY order's price (see
 * getRebalanceOrderPrice), and the maker fee on top (see getMakerFee).
 */
export const getRebalanceBuyCost = (amount: number, price: number, marketData: MarketData): number =>
  amount * getRebalanceOrderPrice('BUY', price, marketData) * (1 + getMakerFee(marketData));

/** A market limit is a bound only as a finite number above 0: Binance disables a filter bound by setting it to 0 (see market.utils) */
const toBound = (limit?: number): number | undefined => (limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined);

/** The step of the amounts, one unit of their last decimal (see inferAmountPrecision): 1e-8 for 8 decimals */
const getAmountStep = (amountDecimals: number): number => Number(`1e-${amountDecimals}`);

/**
 * The smallest amount of an order at `price` that the market takes: one amount step at least, amount.min and cost.min / price,
 * rounded up to the amount precision (see inferAmountPrecision). The simulator and CCXTExchange check the cost as amount × price in
 * floating point, which comes out one ulp under cost.min where the decimal product is exactly cost.min (0.00007 × 100000 is
 * 6.999999999999999): one step more is taken then.
 */
export const getMinimumAmount = (price: number, marketData: MarketData): number => {
  const amountDecimals = inferAmountPrecision(marketData);
  const step = getAmountStep(amountDecimals);
  const minimumCost = toBound(marketData.cost?.min);
  const atCost = minimumCost && price > 0 ? minimumCost / price : 0;
  // Rounded up as -(the negated value rounded down): round has no ceiling
  const minimum = Math.max(step, -round(-Math.max(toBound(marketData.amount?.min) ?? 0, atCost), amountDecimals, 'down'));
  return minimumCost && minimum * price < minimumCost ? addPrecise(minimum, step) : minimum;
};

/**
 * The largest amount of an order at `price` that the market takes: amount.max and cost.max / price, rounded down to the amount
 * precision, one step less should the cost still come out over cost.max in floating point (0.00001 × 300000 is 3.0000000000000004).
 * Infinity when the market sets neither.
 */
export const getMaximumAmount = (price: number, marketData: MarketData): number => {
  const amountDecimals = inferAmountPrecision(marketData);
  const maximumCost = toBound(marketData.cost?.max);
  const atCost = maximumCost && price > 0 ? maximumCost / price : Infinity;
  const limit = Math.min(toBound(marketData.amount?.max) ?? Infinity, atCost);
  if (!Number.isFinite(limit)) return Infinity;
  const maximum = roundAmount(limit, amountDecimals);
  return maximumCost && maximum * price > maximumCost ? addPrecise(maximum, -getAmountStep(amountDecimals)) : maximum;
};

/**
 * Infer price precision from market data or use default.
 * Returns both the decimal count and optional price step for tick-based rounding.
 */
export const inferPricePrecision = (currentPrice: number, marketData: MarketData): { priceDecimals: number; priceStep?: number } => {
  const priceStep = marketData.precision?.price;
  if (priceStep && priceStep > 0) {
    return { priceDecimals: countDecimals(priceStep), priceStep };
  }
  return { priceDecimals: countDecimals(currentPrice) };
};

/**
 * Infer amount precision from market data or use default.
 */
export const inferAmountPrecision = (marketData: MarketData): number => {
  const precision = marketData.precision?.amount;
  return precision && precision > 0 ? countDecimals(precision) : DEFAULT_AMOUNT_PRECISION;
};

/**
 * Count decimal places in a number, handling scientific notation.
 */
export const countDecimals = (num: number): number => {
  if (!Number.isFinite(num)) return DEFAULT_PRICE_PRECISION;
  const str = num.toString();
  if (str.includes('e')) {
    const [base, exp] = str.split('e');
    const baseDecimals = base.split('.')[1]?.length ?? 0;
    return Math.max(0, baseDecimals - Number(exp));
  }
  return str.split('.')[1]?.length ?? 0;
};

/**
 * Round price to specified precision, optionally snapping to price step.
 */
export const roundPrice = (value: number, priceDecimals: number, priceStep?: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (priceStep && priceStep > 0) {
    const steps = Math.round(value / priceStep);
    return round(steps * priceStep, priceDecimals);
  }
  return round(value, priceDecimals);
};

/**
 * Round amount to specified precision.
 */
export const roundAmount = (value: number, amountDecimals: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round(value, amountDecimals, 'down');
};

/**
 * Compute the price of the grid `levelIndex` steps away from the center price, based on spacing type.
 * @param centerPrice - The center price of the grid
 * @param levelIndex - Steps from the center price: negative below it, positive above, 0 for the center price itself
 * @param priceDecimals - Number of decimal places for rounding
 * @param spacingType - Type of spacing calculation
 * @param spacingValue - Spacing parameter value
 * @param priceStep - Optional price step for tick rounding
 */
export const computeLevelPrice = (
  centerPrice: number,
  levelIndex: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): number => {
  if (levelIndex === 0) return centerPrice;

  const steps = Math.abs(levelIndex);
  const direction = levelIndex > 0 ? 1 : -1;
  let price: number;

  switch (spacingType) {
    case 'fixed':
      price = centerPrice + direction * spacingValue * steps;
      break;
    case 'percent':
      price = centerPrice * (1 + (direction * spacingValue * steps) / 100);
      break;
    case 'logarithmic': {
      const multiplier = 1 + spacingValue;
      if (multiplier <= 0) return 0;
      price = direction > 0 ? centerPrice * multiplier ** steps : centerPrice / multiplier ** steps;
      break;
    }
  }

  return roundPrice(price, priceDecimals, priceStep);
};

/**
 * Compute grid bounds (min and max prices) for the given configuration.
 */
export const computeGridBounds = (
  centerPrice: number,
  buyLevels: number,
  sellLevels: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): GridBounds | null => {
  if (buyLevels <= 0 && sellLevels <= 0) return null;

  const min = buyLevels > 0 ? computeLevelPrice(centerPrice, -buyLevels, priceDecimals, spacingType, spacingValue, priceStep) : centerPrice;
  const max =
    sellLevels > 0 ? computeLevelPrice(centerPrice, sellLevels, priceDecimals, spacingType, spacingValue, priceStep) : centerPrice;

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;

  return { min, max };
};

/**
 * Check if price is outside grid bounds.
 */
export const isOutOfRange = (currentPrice: number, bounds: GridBounds): boolean => {
  return currentPrice < bounds.min || currentPrice > bounds.max;
};

/**
 * Validate grid configuration against the center price and the exchange limits. The parameters themselves were checked by the
 * schema (gridBot.schema.ts) before the strategy was created.
 * Returns an error message if invalid, null if valid.
 */
export const validateConfig = (params: GridBotStrategyParams, centerPrice: number, marketData: MarketData): string | null => {
  if (centerPrice <= 0) return 'Center price must be positive';

  const { priceDecimals, priceStep } = inferPricePrecision(centerPrice, marketData);

  // Check if lowest buy price would be positive
  const { buyLevels, spacingType, spacingValue } = params;
  if (buyLevels > 0) {
    const lowestBuyPrice = computeLevelPrice(centerPrice, -buyLevels, priceDecimals, spacingType, spacingValue, priceStep);
    if (lowestBuyPrice <= 0) {
      return `Grid configuration would result in non-positive buy prices: the lowest of buyLevels ${buyLevels}, spaced by spacingValue ${spacingValue} (${spacingType}) below the center price ${centerPrice}, would be at ${lowestBuyPrice}`;
    }
  }

  // Check against exchange price limits
  if (marketData.price?.min && centerPrice < marketData.price.min) {
    return `Center price ${centerPrice} is below exchange minimum ${marketData.price.min}`;
  }
  if (marketData.price?.max && centerPrice > marketData.price.max) {
    return `Center price ${centerPrice} is above exchange maximum ${marketData.price.max}`;
  }

  return null;
};

/**
 * Compute rebalance plan to achieve optimal allocation based on buy/sell level ratio, on the balances given: the free ones, which the
 * grid is sized on.
 * The target allocation ensures equal quantity per order across all levels.
 * For N buy levels and M sell levels: targetAssetRatio = M / (N + M)
 * A BUY is at most what the currency pays once placed (see getRebalanceBuyCost), and an order is at most the market's maximum (see
 * getMaximumAmount). An amount under the market's minimum is left as it is (see getMinimumAmount), for the strategy not to send it.
 * Returns null if portfolio is already optimally balanced.
 */
export const computeRebalancePlan = (
  centerPrice: number,
  assetFree: number,
  currencyFree: number,
  buyLevels: number,
  sellLevels: number,
  marketData: MarketData,
): RebalancePlan | null => {
  if (centerPrice <= 0) return null;
  if (buyLevels <= 0 && sellLevels <= 0) return null;
  const totalLevels = buyLevels + sellLevels;
  const assetValue = assetFree * centerPrice;
  const currencyValue = currencyFree;
  const totalValue = assetValue + currencyValue;

  if (totalValue <= 0) return null;

  // Target asset ratio is sellLevels / totalLevels
  // (assets are sold on sell levels, currency is used on buy levels)
  const targetAssetRatio = sellLevels / totalLevels;
  const targetAssetValue = totalValue * targetAssetRatio;
  const gap = targetAssetValue - assetValue;

  // Small gap - no rebalance needed (within 1% of target)
  if (Math.abs(gap) < 0.01 * totalValue) return null;

  const side = gap > 0 ? 'BUY' : 'SELL';
  let amount = Math.abs(gap) / centerPrice;
  // A BUY is at most what the currency pays, at the price its STICKY order is placed at and with the fee on top. A sell-only grid,
  // which wants the whole value in the asset, planned a BUY of the whole currency at the center price: the simulator refused it at
  // every attempt, and the run stopped before any grid was built
  if (side === 'BUY') amount = Math.min(amount, currencyFree / getRebalanceBuyCost(1, centerPrice, marketData));

  if (amount <= 0) return null;

  // Rounded down to the amount precision, at most the market's maximum. An amount under amount.min used to be raised to it, beyond
  // what the gap called for and what the balances paid: a rebalance under the market's minimum is no order to send
  const amountDecimals = inferAmountPrecision(marketData);
  const orderPrice = getRebalanceOrderPrice(side, centerPrice, marketData);
  amount = Math.min(roundAmount(amount, amountDecimals), getMaximumAmount(orderPrice, marketData));

  if (amount <= 0) return null;

  return {
    side,
    amount,
    estimatedNotional: amount * centerPrice,
    centerPrice,
  };
};

/**
 * Sizes the grid on the free balances: the quantity every order of the grid trades, and the levels it funds, the nearest to the
 * center price. Every order is placed at or above the lowest price of the grid, so a quantity of at least the market's minimum there
 * (see getMinimumAmount) is one the market takes for every order. A side whose free balance cannot fund each of its levels with that
 * minimum keeps the levels it funds and leaves out the farthest: none at all for a side that funds no level.
 * - A SELL needs its amount of the asset: the sell levels share the free asset.
 * - A BUY needs its cost with the maker fee on top (see getMakerFee): the buy levels share the free currency in proportion to their
 *   prices. Sized on the prices alone, the BUYs needed the whole free currency before their fees: the simulator refused the last one
 *   placed, the highest, at every attempt.
 * The quantity is the smaller of the two shares, rounded down to the amount precision, at most the market's maximum at the highest
 * price of the grid (see getMaximumAmount): 0, with no level, when the free balances fund none.
 */
export const deriveLevelQuantity = (
  centerPrice: number,
  assetFree: number,
  currencyFree: number,
  buyLevels: number,
  sellLevels: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  marketData: MarketData,
  priceStep?: number,
): GridSize => {
  const priceAt = (steps: number) => computeLevelPrice(centerPrice, steps, priceDecimals, spacingType, spacingValue, priceStep);
  const amountDecimals = inferAmountPrecision(marketData);

  // The sums of the BUY prices from the center price down, as far as they are positive: buildGrid builds no level priced at 0 or below
  const buyPriceSums = [0];
  for (let i = 1; i <= buyLevels; i++) {
    const price = priceAt(-i);
    if (price <= 0) break;
    buyPriceSums.push(buyPriceSums[i - 1] + price);
  }
  const currencyShare = (levels: number) => (levels > 0 ? currencyFree / (buyPriceSums[levels] * (1 + getMakerFee(marketData))) : Infinity);
  const assetShare = (levels: number) => (levels > 0 ? assetFree / levels : Infinity);
  // The market minimum at the lowest price of a grid of `levels` buy levels: its lowest BUY, or without any the center price, where
  // the first sell level buys once it has sold
  const minimumAt = (levels: number) => getMinimumAmount(levels > 0 ? priceAt(-levels) : centerPrice, marketData);

  // The quantity used to be raised to amount.min, or to cost.min at the lowest price, beyond what the balances funded, and left
  // unrounded: the last orders placed were refused for want of funds, and CCXTExchange truncated the others to the amount step,
  // under cost.min again, so that a small account had most of its levels refused at every attempt
  let fundedBuyLevels = buyPriceSums.length - 1;
  while (fundedBuyLevels > 0 && roundAmount(currencyShare(fundedBuyLevels), amountDecimals) < minimumAt(fundedBuyLevels)) fundedBuyLevels--;
  const minimumAmount = minimumAt(fundedBuyLevels);
  let fundedSellLevels = Math.max(sellLevels, 0);
  while (fundedSellLevels > 0 && roundAmount(assetShare(fundedSellLevels), amountDecimals) < minimumAmount) fundedSellLevels--;

  if (fundedBuyLevels === 0 && fundedSellLevels === 0) return { quantity: 0, buyLevels: 0, sellLevels: 0, minimumAmount };

  const share = roundAmount(Math.min(assetShare(fundedSellLevels), currencyShare(fundedBuyLevels)), amountDecimals);
  // At most the market maximum at the highest price of the grid: its highest SELL, or without any the center price, where the first
  // buy level sells once it has bought
  const quantity = Math.min(share, getMaximumAmount(priceAt(fundedSellLevels), marketData));
  return { quantity, buyLevels: fundedBuyLevels, sellLevels: fundedSellLevels, minimumAmount };
};

/**
 * Check if only one side has active orders (for warning purposes). It reads the side of each level holding an order, which is the
 * side of that order: fills change it.
 */
export const hasOnlyOneSide = (levels: Array<{ side: 'BUY' | 'SELL'; orderId?: string }>): boolean => {
  let hasBuy = false;
  let hasSell = false;

  for (const level of levels) {
    if (!level.orderId) continue;
    if (level.side === 'BUY') hasBuy = true;
    else hasSell = true;
    if (hasBuy && hasSell) return false;
  }

  return hasBuy || hasSell;
};

/**
 * Whether an order error leaves the outcome of the order unknown: it may be live on the exchange, while the Trader, which forgets an
 * order once it errored, tracks it no more. Read from the reason as the order layer and CCXTExchange word it, "Outcome unknown: the
 * order may be live on the exchange" for a creation lost on the network (Order.toCreationError) and "the order may exist on the
 * exchange" for a creation answered with neither a status nor an id, since the event carries no field saying so. An error worded by
 * the exchange itself is not recognised, such as a poll that failed for good once the order was live.
 */
export const isOutcomeUnknown = (reason: string): boolean => /the order may (?:be live|exist) on the exchange/i.test(reason);
