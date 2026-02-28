import { MarketData, MarketValidationResult } from '@services/exchange/exchange.types';
import { isNil } from 'lodash-es';

/** Checks if the order price is within the market data */
export const checkOrderPrice = (price: number, marketData: MarketData): MarketValidationResult<number> => {
  const priceLimits = marketData?.price;
  const minimalPrice = priceLimits?.min;
  const maximalPrice = priceLimits?.max;

  if (isNil(minimalPrice) && isNil(maximalPrice)) return { isValid: true, value: price };

  if (!isNil(minimalPrice) && price < minimalPrice) {
    return { isValid: false, reason: 'price', min: minimalPrice, max: maximalPrice };
  }

  if (!isNil(maximalPrice) && price > maximalPrice) {
    return { isValid: false, reason: 'price', min: minimalPrice, max: maximalPrice };
  }

  return { isValid: true, value: price };
};

/** Checks if the order amount is within the market data */
export const checkOrderAmount = (amount: number, marketData: MarketData): MarketValidationResult<number> => {
  const amountLimits = marketData?.amount;
  const minimalAmount = amountLimits?.min;
  const maximalAmount = amountLimits?.max;

  if (isNil(minimalAmount) && isNil(maximalAmount)) return { isValid: true, value: amount };

  if (!isNil(minimalAmount) && amount < minimalAmount) {
    return { isValid: false, reason: 'amount', min: minimalAmount, max: maximalAmount };
  }

  if (!isNil(maximalAmount) && amount > maximalAmount) {
    return { isValid: false, reason: 'amount', min: minimalAmount, max: maximalAmount };
  }

  return { isValid: true, value: amount };
};

/** Checks if the order cost is within the market data */
export const checkOrderCost = (amount: number, price: number, marketData: MarketData): MarketValidationResult<number> => {
  const costLimits = marketData?.cost;
  const minimalCost = costLimits?.min;
  const maximalCost = costLimits?.max;

  const cost = amount * price;

  if (isNil(minimalCost) && isNil(maximalCost)) return { isValid: true, value: cost };

  if (!isNil(minimalCost) && cost < minimalCost) {
    return { isValid: false, reason: 'cost', min: minimalCost, max: maximalCost };
  }

  if (!isNil(maximalCost) && cost > maximalCost) {
    return { isValid: false, reason: 'cost', min: minimalCost, max: maximalCost };
  }

  return { isValid: true, value: cost };
};
