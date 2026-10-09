import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Tag } from '@models/tag.types';
import { MarketData, MarketValidationResult } from '@services/exchange/exchange.types';
import { isNil, max, min } from 'lodash-es';

/** NaN, ±Infinity, zero and negative numbers are never a valid order price, amount or cost, whatever the market limits */
const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * A market limit that is not a finite number above 0 sets no bound. Binance disables a filter bound by setting it to 0, and ccxt
 * copies the PRICE_FILTER maxPrice of 0 into limits.price.max, where it would refuse every price. A minimum of 0 or below bounds
 * nothing anyway, since the value itself must be above 0. The invalid results report these normalized bounds.
 */
const toBound = (limit?: number) => (!isNil(limit) && isFinitePositive(limit) ? limit : undefined);

/** Checks if the order price is a finite positive number within the market data */
export const checkOrderPrice = (price: number, marketData: MarketData): MarketValidationResult<number> => {
  const priceLimits = marketData?.price;
  const minimalPrice = toBound(priceLimits?.min);
  const maximalPrice = toBound(priceLimits?.max);

  if (!isFinitePositive(price)) return { isValid: false, reason: 'price', min: minimalPrice, max: maximalPrice };

  if (isNil(minimalPrice) && isNil(maximalPrice)) return { isValid: true, value: price };

  if (!isNil(minimalPrice) && price < minimalPrice) {
    return { isValid: false, reason: 'price', min: minimalPrice, max: maximalPrice };
  }

  if (!isNil(maximalPrice) && price > maximalPrice) {
    return { isValid: false, reason: 'price', min: minimalPrice, max: maximalPrice };
  }

  return { isValid: true, value: price };
};

/** Checks if the order amount is a finite positive number within the market data */
export const checkOrderAmount = (amount: number, marketData: MarketData): MarketValidationResult<number> => {
  const amountLimits = marketData?.amount;
  const minimalAmount = toBound(amountLimits?.min);
  const maximalAmount = toBound(amountLimits?.max);

  if (!isFinitePositive(amount)) return { isValid: false, reason: 'amount', min: minimalAmount, max: maximalAmount };

  if (isNil(minimalAmount) && isNil(maximalAmount)) return { isValid: true, value: amount };

  if (!isNil(minimalAmount) && amount < minimalAmount) {
    return { isValid: false, reason: 'amount', min: minimalAmount, max: maximalAmount };
  }

  if (!isNil(maximalAmount) && amount > maximalAmount) {
    return { isValid: false, reason: 'amount', min: minimalAmount, max: maximalAmount };
  }

  return { isValid: true, value: amount };
};

/** Checks if the order cost (amount × price) is a finite positive number within the market data */
export const checkOrderCost = (amount: number, price: number, marketData: MarketData): MarketValidationResult<number> => {
  const costLimits = marketData?.cost;
  const minimalCost = toBound(costLimits?.min);
  const maximalCost = toBound(costLimits?.max);

  const cost = amount * price;

  if (!isFinitePositive(cost)) return { isValid: false, reason: 'cost', min: minimalCost, max: maximalCost };

  if (isNil(minimalCost) && isNil(maximalCost)) return { isValid: true, value: cost };

  if (!isNil(minimalCost) && cost < minimalCost) {
    return { isValid: false, reason: 'cost', min: minimalCost, max: maximalCost };
  }

  if (!isNil(maximalCost) && cost > maximalCost) {
    return { isValid: false, reason: 'cost', min: minimalCost, max: maximalCost };
  }

  return { isValid: true, value: cost };
};

/**
 * The limits a market order is checked against. Binance applies two lot size filters to a MARKET order: LOT_SIZE, which ccxt maps to
 * limits.amount, and MARKET_LOT_SIZE, mapped to limits.market, whose maximum is far lower on a liquid pair (tens of BTC on BTCUSDT,
 * against 9000). Checked against the amount range alone, an order between the two maxima was sent, to be refused by Binance with a
 * misleading "order amount should be evenly divisible by lot size" (-1013), and filled by the simulator of paper trading.
 * The amount range is narrowed to the higher of the two minimums and the lower of the two maximums (lodash's max and min skip the
 * bounds left undefined), a bound that is not a finite number above 0 setting nothing, as in toBound: the MARKET_LOT_SIZE minQty of
 * 0 on BTCUSDT. Market data without a market range, a dummy-cex configuration for one, is returned as it is.
 */
export const getMarketOrderLimits = (marketData: MarketData): MarketData => {
  const { amount, market } = marketData;
  if (isNil(market)) return marketData;
  return {
    ...marketData,
    amount: { min: max([toBound(amount?.min), toBound(market.min)]), max: min([toBound(amount?.max), toBound(market.max)]) },
  };
};

/**
 * Checks the price, then the amount, then the cost of an order against the market limits.
 * Throws an OrderOutOfRangeError for the first invalid value, returns the validated values otherwise.
 */
export const assertOrderWithinLimits = ({
  tag,
  amount,
  price,
  marketData,
}: {
  tag: Tag;
  amount: number;
  price: number;
  marketData: MarketData;
}): { amount: number; price: number; cost: number } => {
  const priceResult = checkOrderPrice(price, marketData);
  if (!priceResult.isValid) throw new OrderOutOfRangeError(tag, priceResult.reason, price, priceResult.min, priceResult.max);

  const amountResult = checkOrderAmount(amount, marketData);
  if (!amountResult.isValid) throw new OrderOutOfRangeError(tag, amountResult.reason, amount, amountResult.min, amountResult.max);

  const costResult = checkOrderCost(amountResult.value, priceResult.value, marketData);
  if (!costResult.isValid)
    throw new OrderOutOfRangeError(tag, costResult.reason, amountResult.value * priceResult.value, costResult.min, costResult.max);

  return { amount: amountResult.value, price: priceResult.value, cost: costResult.value };
};
