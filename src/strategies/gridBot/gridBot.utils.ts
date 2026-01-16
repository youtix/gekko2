import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { Tools } from '@strategies/strategy.types';
import { round } from '@utils/math/round.utils';
import { DEFAULT_AMOUNT_PRECISION, DEFAULT_PRICE_PRECISION, EMPTY_BALANCE } from './gridBot.const';
import { GridBotStrategyParams, GridBounds, GridSpacingType, RebalancePlan } from './gridBot.types';

export const getPair = (tools: Tools<GridBotStrategyParams>): { base: string; quote: string } => {
  if (tools.pairs.length !== 1) tools.log('error', 'GridBot: Only one pair is supported for this strategy');
  const [base, quote] = tools.pairs[0];
  return { base, quote };
};

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
 * Infer price precision from market data or use default.
 * Returns both the decimal count and optional price step for tick-based rounding.
 */
export const inferPricePrecision = (
  currentPrice: number,
  marketData: MarketData,
): { priceDecimals: number; priceStep?: number } => {
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
 * Compute price for a grid level based on spacing type.
 * @param centerPrice - The center price of the grid
 * @param levelIndex - Negative for buy levels, positive for sell levels
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

  const min =
    buyLevels > 0
      ? computeLevelPrice(centerPrice, -buyLevels, priceDecimals, spacingType, spacingValue, priceStep)
      : centerPrice;
  const max =
    sellLevels > 0
      ? computeLevelPrice(centerPrice, sellLevels, priceDecimals, spacingType, spacingValue, priceStep)
      : centerPrice;

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
 * Validate grid configuration against exchange limits.
 * Returns an error message if invalid, null if valid.
 */
export const validateConfig = (
  params: GridBotStrategyParams,
  centerPrice: number,
  marketData: MarketData,
): string | null => {
  if (centerPrice <= 0) return 'Center price must be positive';
  if (params.buyLevels < 0 || params.sellLevels < 0) return 'Level counts must be non-negative';
  if (params.buyLevels === 0 && params.sellLevels === 0) return 'At least one level is required';
  if (params.spacingValue <= 0) return 'Spacing value must be positive';

  const { priceDecimals, priceStep } = inferPricePrecision(centerPrice, marketData);

  // Check if lowest buy price would be positive
  if (params.buyLevels > 0) {
    const lowestBuyPrice = computeLevelPrice(
      centerPrice,
      -params.buyLevels,
      priceDecimals,
      params.spacingType,
      params.spacingValue,
      priceStep,
    );
    if (lowestBuyPrice <= 0) return 'Grid configuration would result in non-positive buy prices';
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
 * Compute rebalance plan to achieve optimal allocation based on buy/sell level ratio.
 * The target allocation ensures equal quantity per order across all levels.
 * For N buy levels and M sell levels: targetAssetRatio = M / (N + M)
 * Returns null if portfolio is already optimally balanced.
 */
export const computeRebalancePlan = (
  centerPrice: number,
  totalAssetValue: number,
  totalCurrencyValue: number,
  buyLevels: number,
  sellLevels: number,
  marketData: MarketData,
): RebalancePlan | null => {
  if (centerPrice <= 0) return null;
  if (buyLevels <= 0 && sellLevels <= 0) return null;
  const totalLevels = buyLevels + sellLevels;
  const assetValue = totalAssetValue * centerPrice;
  const currencyValue = totalCurrencyValue;
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

  if (amount <= 0) return null;

  // Apply amount rounding
  const amountDecimals = inferAmountPrecision(marketData);
  amount = roundAmount(amount, amountDecimals);

  // Apply amount limits
  amount = applyAmountLimits(amount, marketData);

  if (amount <= 0) return null;

  return {
    side,
    amount,
    estimatedNotional: amount * centerPrice,
    centerPrice,
  };
};

/**
 * Apply exchange amount limits to quantity.
 */
export const applyAmountLimits = (quantity: number, marketData: MarketData): number => {
  if (quantity <= 0) return quantity;

  let adjusted = quantity;
  if (marketData.amount?.min) adjusted = Math.max(adjusted, marketData.amount.min);
  if (marketData.amount?.max) adjusted = Math.min(adjusted, marketData.amount.max);

  return adjusted;
};

/**
 * Apply exchange cost limits to quantity.
 */
export const applyCostLimits = (
  quantity: number,
  minPrice: number,
  maxPrice: number,
  marketData: MarketData,
): number => {
  if (quantity <= 0) return quantity;

  let adjusted = quantity;
  if (marketData.cost?.min && minPrice > 0) {
    adjusted = Math.max(adjusted, marketData.cost.min / minPrice);
  }
  if (marketData.cost?.max && maxPrice > 0) {
    adjusted = Math.min(adjusted, marketData.cost.max / maxPrice);
  }

  return adjusted;
};

/**
 * Derive quantity per level from portfolio based on grid configuration.
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
): number => {
  if (buyLevels <= 0 && sellLevels <= 0) return 0;

  // Calculate sell capacity: assets / sell levels
  const assetShare = sellLevels > 0 ? assetFree / sellLevels : Infinity;

  // Calculate buy capacity using actual level prices
  let currencyShare = Infinity;
  if (buyLevels > 0) {
    let totalBuyCost = 0;
    for (let i = 1; i <= buyLevels; i++) {
      const levelPrice = computeLevelPrice(centerPrice, -i, priceDecimals, spacingType, spacingValue, priceStep);
      if (levelPrice > 0) totalBuyCost += levelPrice;
    }
    if (totalBuyCost > 0) {
      currencyShare = currencyFree / totalBuyCost;
    }
  }

  const derived = Math.min(assetShare, currencyShare);
  if (!Number.isFinite(derived) || derived <= 0) return 0;

  // Apply rounding
  const amountDecimals = inferAmountPrecision(marketData);
  let quantity = roundAmount(derived, amountDecimals);

  // Apply limits
  quantity = applyAmountLimits(quantity, marketData);

  // Apply cost limits if we have grid bounds
  const bounds = computeGridBounds(
    centerPrice,
    buyLevels,
    sellLevels,
    priceDecimals,
    spacingType,
    spacingValue,
    priceStep,
  );
  if (bounds) {
    quantity = applyCostLimits(quantity, bounds.min, bounds.max, marketData);
  }

  return quantity;
};

/**
 * Check if only one side has active orders (for warning purposes).
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
