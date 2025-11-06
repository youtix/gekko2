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

export const findWhyWeCannotBuy = (amount: number, price: number, currencyAmount: number, currencySymbol: string) => {
  const needed = amount * price;
  const shortfall = Math.max(0, needed - currencyAmount);
  return amount <= 0
    ? `invalid amount (${amount})`
    : price <= 0
      ? `invalid price (${price})`
      : `need ${needed.toFixed(8)} ${currencySymbol}, have ${currencyAmount.toFixed(8)} ${currencySymbol}, shortfall ${shortfall.toFixed(8)} ${currencySymbol}`;
};

export const findWhyWeCannotSell = (amount: number, price: number, assetAmount: number, assetSymbol: string) => {
  const shortfall = Math.max(0, amount - assetAmount);
  return amount <= 0
    ? `invalid amount (${amount})`
    : price <= 0
      ? `invalid price (${price})`
      : `need ${amount.toFixed(8)} ${assetSymbol}, have ${assetAmount.toFixed(8)} ${assetSymbol}, shortfall ${shortfall.toFixed(8)} ${assetSymbol}`;
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
