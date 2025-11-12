import { GekkoError } from '@errors/gekko.error';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
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

export const isEmptyPortfolio = (portfolio: Portfolio) => {
  return portfolio.asset <= 0 && portfolio.currency <= 0;
};
