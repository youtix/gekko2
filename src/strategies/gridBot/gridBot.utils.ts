import { Portfolio } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { Tools } from '@strategies/strategy.types';
import { round } from '@utils/math/round.utils';
import { DEFAULT_AMOUNT_ROUNDING, INTERNAL_OPEN_ORDER_CAP } from './gridBot.const';
import {
  GridBotStrategyParams,
  GridRange,
  GridSpacingType,
  LevelState,
  RebalancePlan,
  RebalanceStage,
} from './gridBot.types';

export const isGridOutOfRange = (currentPrice: number, gridBounds: GridRange) => {
  return currentPrice < gridBounds.min || currentPrice > gridBounds.max;
};

export const isOnlyOneSideRemaining = (levelStates: Map<number, LevelState>) => {
  let buy = 0;
  let sell = 0;
  for (const level of levelStates.values()) {
    if (!level.activeOrderId || !level.desiredSide) continue;
    if (level.desiredSide === 'BUY') buy++;
    else sell++;
  }
  return buy === 0 || sell === 0;
};

/** Merge user cap with internal cap, ensuring at least 2 orders can exist. */
export const resolveOrderCap = (override?: number): number => {
  if (!override || override <= 0) return INTERNAL_OPEN_ORDER_CAP;
  return Math.max(2, Math.min(INTERNAL_OPEN_ORDER_CAP, Math.floor(override)));
};

/** Count decimals, handling scientific notation like 1e-7. */
export const countDecimals = (num: number): number => {
  const s = num.toString();
  if (s.includes('e')) {
    const [base, exp] = s.split('e');
    return Math.max(0, (base.split('.')[1]?.length || 0) - Number(exp));
  }
  return s.split('.')[1]?.length || 0;
};

/** Round price to the nearest tick or candle precision. */
export const roundPrice = (value: number, priceDecimals: number, priceStep?: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (priceStep && priceStep > 0) {
    const steps = Math.round(value / priceStep);
    return round(steps * priceStep, priceDecimals);
  }
  const factor = 10 ** priceDecimals;
  return Math.round(value * factor) / factor;
};

/** Compute and round price for a level according to spacing type. */
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

  let price = centerPrice;
  switch (spacingType) {
    case 'fixed':
      price = centerPrice + direction * spacingValue * steps;
      break;
    case 'percent': {
      const percent = spacingValue / 100;
      price = centerPrice * (1 + direction * percent * steps);
      break;
    }
    case 'geometric':
    case 'logarithmic': {
      const multiplier = 1 + spacingValue;
      if (multiplier <= 0) return 0;
      price = direction > 0 ? centerPrice * multiplier ** steps : centerPrice / multiplier ** steps;
      break;
    }
  }

  return roundPrice(price, priceDecimals, priceStep);
};

/** Estimate min/max prices spanned by the grid; used for validation and cost checks. */
export const estimatePriceRange = (
  centerPrice: number,
  levelsPerSide: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): { min: number; max: number } | null => {
  if (levelsPerSide <= 0) return null;
  const min = computeLevelPrice(centerPrice, -levelsPerSide, priceDecimals, spacingType, spacingValue, priceStep);
  const max = computeLevelPrice(centerPrice, levelsPerSide, priceDecimals, spacingType, spacingValue, priceStep);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
  return { min, max };
};

/** Generate level indices from -N..N (center 0 kept idle). */
export const buildLevelIndexes = (levelsPerSide: number): number[] => {
  const indexes: number[] = [];
  for (let i = -levelsPerSide; i <= levelsPerSide; i++) {
    indexes.push(i);
  }
  return indexes;
};
/**
 * Infer quantity per level (when not provided): split asset/currency across sides
 * and use the smaller capacity to avoid rejections.
 */
export const resolveLevelQuantity = (
  centerPrice: number,
  portfolio: Portfolio,
  levelsPerSide: number,
  marketData: MarketData,
  override?: number,
): number => {
  if (override && override > 0) return override;
  if (levelsPerSide <= 0) return 0;
  const perSide = Math.max(1, levelsPerSide);
  const assetShare = portfolio.asset / perSide;
  const currencyShare = portfolio.currency / (perSide * Math.max(centerPrice, Number.EPSILON));
  const derived = Math.min(assetShare, currencyShare);

  // Round quantity to avoid floating point number problem when comparing with exchange
  const { amountDecimals } = inferAmountPrecision(marketData);
  return Number.isFinite(derived) ? round(derived, amountDecimals, 'down') : 0;
};

/** Apply amount min/max from market data if available. */
export const applyAmountLimits = (quantity: number, marketData: MarketData): number => {
  if (!quantity || quantity <= 0) return quantity;
  const { amount } = marketData;
  let adjusted = quantity;
  if (amount?.min) adjusted = Math.max(adjusted, amount.min);
  if (amount?.max) adjusted = Math.min(adjusted, amount.max);
  return adjusted;
};

/** Apply cost min/max from market data across the grid range. */
export const applyCostLimits = (
  quantity: number,
  minPrice: number,
  maxPrice: number,
  marketData: MarketData,
): number => {
  if (!quantity || quantity <= 0) return quantity;
  const { cost } = marketData;
  let adjusted = quantity;
  if (cost?.min && minPrice > 0) adjusted = Math.max(adjusted, cost.min / minPrice);
  if (cost?.max && maxPrice > 0) adjusted = Math.min(adjusted, cost.max / maxPrice);
  return adjusted;
};

/**
 * Compute how many levels per side are affordable:
 * - Buys limited by currency and the closest-buy price (highest below center).
 * - Sells limited by asset holdings.
 */
export const computeAffordableLevels = (
  centerPrice: number,
  portfolio: Portfolio,
  quantity: number,
  maxLevels: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): number => {
  if (maxLevels <= 0 || quantity <= 0) return 0;
  const highestBuyPrice = computeLevelPrice(centerPrice, -1, priceDecimals, spacingType, spacingValue, priceStep);
  if (highestBuyPrice <= 0) return 0;
  const maxBuys = Math.floor(portfolio.currency / (quantity * highestBuyPrice));
  const maxSells = Math.floor(portfolio.asset / quantity);
  return Math.max(0, Math.min(maxLevels, maxBuys, maxSells));
};

export const validateRebalancePlan = (
  plan: RebalancePlan,
  portfolio: Portfolio,
  tools: Tools<GridBotStrategyParams>,
): boolean => {
  const { log, marketData } = tools;
  const { side, amount, tolerancePercent, estimatedNotional } = plan;
  if (!Number.isFinite(amount) || amount <= 0) return false;

  if (side === 'SELL' && amount > portfolio.asset) {
    log('warn', 'GridBot rebalance skipped: insufficient asset balance for planned sell.');
    return false;
  }

  if (side === 'BUY' && estimatedNotional > portfolio.currency) {
    log('warn', 'GridBot rebalance skipped: insufficient currency balance for planned buy.');
    return false;
  }

  const { amount: amountLimits, cost } = marketData ?? {};
  if (amountLimits?.min && amount < amountLimits.min) {
    log(
      'info',
      `GridBot rebalance skipped: computed amount ${amount} below amount.min ${amountLimits.min} (tolerance ${tolerancePercent}%).`,
    );
    return false;
  }
  if (amountLimits?.max && amount > amountLimits.max) {
    log('info', `GridBot rebalance skipped: computed amount ${amount} above amount.max ${amountLimits.max}.`);
    return false;
  }

  if (cost?.min && estimatedNotional < cost.min) {
    log(
      'info',
      `GridBot rebalance skipped: notional ${estimatedNotional} below cost.min ${cost.min} (tolerance ${tolerancePercent}%).`,
    );
    return false;
  }
  if (cost?.max && estimatedNotional > cost.max) {
    log('info', `GridBot rebalance skipped: notional ${estimatedNotional} above cost.max ${cost.max}.`);
    return false;
  }

  return true;
};

/** Use price.min as tick size if provided; otherwise infer decimals from candle price. */
export const inferPricePrecision = (currentPrice: number, marketData: MarketData) => {
  const priceStep = marketData.precision?.price ?? 0;
  const price = priceStep > 0 ? priceStep : currentPrice;
  return {
    priceDecimals: countDecimals(price),
    ...(priceStep > 0 && { priceStep }),
  };
};

export const inferAmountPrecision = (marketData: MarketData) => ({
  amountDecimals: marketData.precision?.amount ? countDecimals(marketData.precision.amount) : DEFAULT_AMOUNT_ROUNDING,
});

export const computeRebalancePlan = (
  stage: RebalanceStage,
  currentPrice: number,
  portfolio: Portfolio,
  marketData: MarketData,
  tolerancePercent: number,
): RebalancePlan | null => {
  const { priceDecimals, priceStep } = inferPricePrecision(currentPrice, marketData);
  const centerPrice = roundPrice(currentPrice, priceDecimals, priceStep);
  if (!Number.isFinite(centerPrice) || centerPrice <= 0) return null;

  const currentAssetValue = portfolio.asset * centerPrice;
  const currentCurrencyValue = portfolio.currency;
  const totalValue = currentAssetValue + currentCurrencyValue;
  if (!Number.isFinite(totalValue) || totalValue <= 0) return null;

  const targetValuePerSide = totalValue / 2;
  const valueGap = targetValuePerSide - currentAssetValue;
  const driftPercent = totalValue > 0 ? (Math.abs(valueGap) / totalValue) * 100 : 0;
  if (driftPercent <= tolerancePercent) return null;

  let amount = Math.abs(valueGap) / centerPrice;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const { amountDecimals } = inferAmountPrecision(marketData);
  amount = round(amount, amountDecimals, 'down');
  amount = applyAmountLimits(amount, marketData);
  if (amount <= 0) return null;

  const estimatedNotional = amount * centerPrice;

  return {
    stage,
    side: valueGap > 0 ? 'BUY' : 'SELL',
    amount,
    centerPrice,
    driftPercent,
    tolerancePercent,
    targetValuePerSide,
    currentAssetValue,
    currentCurrencyValue,
    estimatedNotional,
  };
};
