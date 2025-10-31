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

export const processCostAndPrice = (side: OrderSide, price: number, amount: number, feePercent?: number) => {
  if (!isNil(feePercent)) {
    const cost = (feePercent / 100) * amount * price;
    if (side === 'BUY') return { effectivePrice: price * (feePercent / 100 + 1), cost };
    else return { effectivePrice: price * (1 - feePercent / 100), cost };
  }

  warning('trader', 'Exchange did not provide fee information, assuming no fees..');
  return { effectivePrice: price, cost: price * amount };
};
