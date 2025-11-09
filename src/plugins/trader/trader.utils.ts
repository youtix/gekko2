import { GekkoError } from '@errors/gekko.error';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { MarketLimits } from '@services/exchange/exchange.types';
import { warning } from '@services/logger';
import { isNil } from 'lodash-es';
import { DEFAULT_FEE_BUFFER } from './trader.const';

export const resolveOrderAmount = (
  portfolio: Portfolio,
  currentPrice: number,
  side: OrderSide,
  quantity = 0,
  marketLimits?: MarketLimits,
) => {
  if (quantity > 0) return quantity;
  if (side === 'BUY') {
    const spendable = portfolio.currency;
    if (!(currentPrice > 0) || !(spendable > 0)) return 0;

    const maxAffordableAmount = spendable / currentPrice;
    const bufferedAmount = maxAffordableAmount * (1 - DEFAULT_FEE_BUFFER);

    const minimalCost = marketLimits?.cost?.min;
    if (!minimalCost || bufferedAmount * currentPrice >= minimalCost) return bufferedAmount;

    const minimalAmount = minimalCost / currentPrice;
    if (minimalAmount <= maxAffordableAmount) return minimalAmount;

    return maxAffordableAmount;
  }
  return portfolio.asset;
};

export interface OrderPricing {
  effectivePrice: number; // per unit, post-fee
  base: number; // amount * price
  fee: number; // base * feeRate
  total: number; // BUY: base+fee, SELL: base-fee
}

export const computeOrderPricing = (
  side: OrderSide,
  price: number,
  amount: number,
  /** in % */
  feePercent?: number,
): OrderPricing => {
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
