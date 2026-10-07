import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Timeframe } from '@models/configuration.types';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
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
  // Invalid price or amount due to exchange returning invalid data or order not filled correctly
  if (Number.isNaN(price) || Number.isNaN(amount) || !(price > 0) || !(amount > 0))
    return { effectivePrice: NaN, base: NaN, fee: NaN, total: NaN };

  const base = amount * price;

  if (!isNil(feePercent) && Number.isFinite(feePercent)) {
    const feeRate = Math.max(0, feePercent) / 100;
    const fee = base * feeRate;
    const total = side === 'BUY' ? base + fee : side === 'SELL' ? base - fee : base;
    const effectivePrice = total / amount;
    return { effectivePrice, base, fee, total };
  }

  // Exchange did not provide fee information, assuming no fees.
  return { effectivePrice: price, base, fee: 0, total: base };
};

export const isEmptyPortfolio = (portfolio: Portfolio): boolean => {
  for (const balance of portfolio.values()) {
    if (balance.total > 0) return false;
  }
  return true;
};

export const getBacktestModeIntervalSyncTime = (timeframe: Timeframe): number => {
  // Minimum 10 minutes to avoid excessive synchronization
  return Math.max(TIMEFRAME_TO_MINUTES[timeframe ?? '1m'], 10);
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
 * Every asset of either portfolio is compared: the exchanges, and the backtest simulator, keep a sold-out asset in the balance with a
 * total of 0, and an asset missing from one side counts as 0 there. Both sides are valued at the current prices (total * price), so
 * that a price move alone is never a change. The quote currency of the pairs is valued at 1, and an asset without a known price
 * (outside the pairs, or no ticker) at 0: below any dust above 0, its changes are never emitted.
 *
 * Algorithm:
 * 1. First sync (lastEmitted is null) → always emit.
 * 2. For each asset of current or lastEmitted, it is dust on a side when its value there is below `dust`, or its quantity is 0:
 *    a. Dust on one side only (a buy-in, or a sell-out to 0 or to dust) → emit.
 *    b. Dust on both sides → ignore it.
 *    c. Otherwise, if its quantity changed by more than `threshold` % since lastEmitted → emit.
 * 3. Otherwise → do not emit.
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
  // A quantity of 0 is never held, even with a dust of 0: a sell-out then crosses the boundary, where a 100% change would not pass a
  // threshold of 100 or more
  const isHeld = (quantity: number, price: number) => quantity > 0 && quantity * price >= portfolioConfig.dust;

  for (const asset of new Set([...current.keys(), ...lastEmitted.keys()])) {
    const price = assetPrices.get(asset) ?? 0;
    const previousQty = lastEmitted.get(asset)?.total ?? 0;
    const currentQty = current.get(asset)?.total ?? 0;
    const wasHeld = isHeld(previousQty, price);

    // Crossing the dust boundary, either way
    if (wasHeld !== isHeld(currentQty, price)) return true;
    // Dust on both sides: noise
    if (!wasHeld) continue;

    // Held on both sides, so previousQty > 0: |current - previous| / previous > threshold
    if (Math.abs(currentQty - previousQty) / previousQty > thresholdFraction) return true;
  }

  return false;
};
