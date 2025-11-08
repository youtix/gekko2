import { GekkoError } from '@errors/gekko.error';
import { OrderSide } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { warning } from '@services/logger';
import { isNil } from 'lodash-es';

export const resolveOrderAmount = (portfolio: Portfolio, currentPrice: number, side: OrderSide, quantity = 0) => {
  if (quantity > 0) return quantity;
  if (side === 'BUY') {
    if (!currentPrice) return 0;
    return (portfolio.currency / currentPrice) * 0.95;
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
