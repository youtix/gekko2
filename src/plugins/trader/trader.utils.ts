import { GekkoError } from '@errors/gekko.error';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { isNil } from 'lodash-es';

type OrderPricing = {
  /** per unit, post-fee */
  effectivePrice: number;
  /** amount * price */
  base: number;
  /** base * feeRate */
  fee: number;
  /** BUY: base+fee, SELL: base-fee */
  total: number;
};

type ComputeOrderPricingFn = (
  side: OrderSide,
  price: number,
  amount: number,
  /** in % */
  feePercent?: number,
) => OrderPricing;

export const computeOrderPricing: ComputeOrderPricingFn = (side, price, amount, feePercent) => {
  if (!(price > 0) || !(amount > 0)) {
    throw new GekkoError('trader', 'Invalid order inputs: price must be > 0 and amount must be > 0');
  }

  const base = amount * price;

  if (!isNil(feePercent) && Number.isFinite(feePercent)) {
    const feeRate = Math.max(0, feePercent) / 100;
    const fee = base * feeRate;
    const total = side === 'BUY' ? base + fee : side === 'SELL' ? base - fee : base;
    const effectivePrice = total / amount;
    return { effectivePrice, base, fee, total };
  }

  warning('trader', 'Exchange did not provide fee information, assuming no fees.');
  return { effectivePrice: price, base, fee: 0, total: base };
};

export const isEmptyPortfolio = (portfolio: Portfolio): boolean => {
  for (const balance of portfolio.values()) {
    if (balance.total > 0) return false;
  }
  return true;
};

/* -------------------------------------------------------------------------- */
/*                      PORTFOLIO EMISSION FILTERING                          */
/* -------------------------------------------------------------------------- */

export type PortfolioUpdatesConfig = {
  /** Percentage change required to emit (e.g., 1 for 1%) */
  threshold: number;
  /** Value in quote currency below which an asset is ignored */
  dust: number;
};

export type ShouldEmitPortfolioParams = {
  current: Portfolio;
  lastEmitted: Portfolio | null;
  prices: Map<TradingPair, number>;
  pairs: TradingPair[];
  portfolioConfig: PortfolioUpdatesConfig;
};

/**
 * Determines whether a portfolio change is significant enough to warrant emitting a `PORTFOLIO_CHANGE_EVENT`.
 *
 * Algorithm:
 * 1. First sync (lastEmitted is null) → always emit.
 * 2. For each asset in current portfolio:
 *    a. Compute value in quote currency (total * assetPrice). Skip if < dust.
 *    b. If asset is new (not in lastEmitted) and value ≥ dust → emit.
 *    c. Compute %-change vs lastEmitted. If > threshold → emit.
 * 3. Check for removed assets (in lastEmitted but not in current) with value ≥ dust → emit.
 * 4. Otherwise → do not emit.
 */
export const shouldEmitPortfolio = ({ current, lastEmitted, prices, pairs, portfolioConfig }: ShouldEmitPortfolioParams): boolean => {
  // First sync → always emit
  if (!lastEmitted) return true;

  // Build asset → price lookup from trading pairs
  // Quote currency (e.g. USDT in BTC/USDT) implicitly has price = 1
  const assetPrices = new Map<string, number>();
  for (const pair of pairs) {
    const [asset, quote] = pair.split('/');
    const price = prices.get(pair);
    if (price !== undefined) assetPrices.set(asset, price);
    if (!assetPrices.has(quote)) assetPrices.set(quote, 1);
  }

  const thresholdFraction = portfolioConfig.threshold / 100;

  // Check current assets for significant changes
  for (const [asset, balance] of current) {
    const assetPrice = assetPrices.get(asset) ?? 0;
    const currentValue = balance.total * assetPrice;

    // Dust check — skip insignificant assets
    if (currentValue < portfolioConfig.dust) continue;

    const previousBalance = lastEmitted.get(asset);

    // New asset appeared with value ≥ dust
    if (!previousBalance) return true;

    // Threshold check: |current - previous| / previous > threshold
    const previousQty = previousBalance.total;
    if (previousQty === 0) {
      // Previous was 0, current is non-zero (and not dust) → significant
      if (balance.total > 0) return true;
      continue;
    }

    const change = Math.abs(balance.total - previousQty) / previousQty;
    if (change > thresholdFraction) return true;
  }

  // Check for removed assets (in lastEmitted but not in current)
  for (const [asset, balance] of lastEmitted) {
    if (current.has(asset)) continue;
    const assetPrice = assetPrices.get(asset) ?? 0;
    const previousValue = balance.total * assetPrice;
    if (previousValue >= portfolioConfig.dust) return true;
  }

  return false;
};
