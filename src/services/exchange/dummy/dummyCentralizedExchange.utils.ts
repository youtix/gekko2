import { MarketData } from '@services/exchange/exchange.types';
import { countDecimals, round, shiftDecimalPoint } from '@utils/math/round.utils';

/** NaN, ±Infinity, zero and negative numbers are neither a value to put on a step nor a step */
const isFinitePositive = (value?: number): value is number => value !== undefined && Number.isFinite(value) && value > 0;

/**
 * value on a multiple of step: the one at or below it ('down'), or the nearest one, a half rounded up ('up'), as ccxt's
 * decimalToPrecision truncates an amount (TRUNCATE) and rounds a price (ROUND) to the step of a market (TICK_SIZE). Worked out on value
 * as it is written (see round): a binary quotient can fall a hair short of a multiple, 0.29 / 0.01 being 28.999999999999996. ccxt 4.5.39
 * rounds its remainder to 8 decimals before comparing it with half a step, so that it rounds a price up from a hair under the half on
 * a step of 1e-5 to 1e-7 (from 0.45 of a step of 1e-7): there the two can be a step apart. A value that is not a finite number above 0
 * is left as it is, for the limits of the market to refuse it, and so is any value without a step that is one.
 */
export const roundToStep = (value: number, step: number | undefined, option: 'down' | 'up'): number => {
  if (!isFinitePositive(value) || !isFinitePositive(step)) return value;
  const decimals = countDecimals(step);
  // A step of one unit of its last decimal (0.01, 1e-8, 1), as Binance, Hyperliquid and a dummy-cex configuration state them
  if (shiftDecimalPoint(step, decimals) === 1) return round(value, decimals, option);
  // Any other step (0.05, 0.5, 5): its multiples, and the halfway points between them, are whole numbers of units of the decimal after
  // its last one. Truncated to that decimal, value passes none of them, and the multiple is worked out on those integers.
  const places = decimals + 1;
  const scaledValue = shiftDecimalPoint(round(value, places, 'down'), places);
  const scaledStep = shiftDecimalPoint(step, places);
  // Past 2 ** 53 integers are no longer exact (a value of some 9e12 on a step of 0.05): in binary, as near as it gets
  if (!Number.isSafeInteger(scaledValue)) return (option === 'down' ? Math.floor : Math.round)(value / step) * step;
  const remainder = scaledValue % scaledStep;
  const isRoundedUp = option === 'up' && 2 * remainder >= scaledStep;
  return shiftDecimalPoint(scaledValue - remainder + (isRoundedUp ? scaledStep : 0), -places);
};

/**
 * The exponent of the first significant digit of a number as String writes it: 4 for 61234.56, -3 for 0.0012345, -7 for 1.5e-7.
 * Read from Math.log10, it is one too many a hair under a power of ten: 999.9999999999999 gives 3.
 */
const getFirstDigitExponent = (value: number): number => {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  return (integer !== '0' ? integer.length - 1 : -(fraction.search(/[1-9]/) + 1)) + Number(exponent);
};

/**
 * The tick of the market at a price: precision.price, or, where a price has at most precision.priceSignificantDigits significant
 * digits (Hyperliquid's 5), the coarser of it and one unit of the last of those digits, one unit at most, an integer part of more
 * digits being kept whole (see MarketData.precision.priceSignificantDigits): 1 from 10000 on, where precision.price may say 0.1.
 */
export const getPriceTick = (price: number, precision: MarketData['precision']): number | undefined => {
  const tick = precision?.price;
  const digits = precision?.priceSignificantDigits;
  if (!digits || !isFinitePositive(price)) return tick;
  const significantTick = Number(`1e-${Math.max(digits - 1 - getFirstDigitExponent(price), 0)}`);
  return isFinitePositive(tick) ? Math.max(tick, significantTick) : significantTick;
};

/**
 * The amount and the price of an order as CCXTExchange sends them to the exchange (see its roundToMarketPrecision): the amount truncated
 * to the step of the market, the price rounded half up to its tick at that price (see getPriceTick). The simulator checks the limits
 * of the market, books the balances and fills the order on them. It used to take them as they came, and so filled quantities a live
 * run never sends: GridBot's 0.00008595077805222816 BTC on a step of 0.00001, which CCXTExchange sends as 0.00008, or an all-in BUY of
 * 17 significant digits, such as the 0.031028229810094173 BTC that 2000 USDT buy at 61234.56 once the Trader keeps 5 % back, sent as
 * 0.03102.
 */
export const roundToMarketPrecision = (amount: number, price: number, { precision }: MarketData) => ({
  amount: roundToStep(amount, precision?.amount, 'down'),
  price: roundToStep(price, getPriceTick(price, precision), 'up'),
});
