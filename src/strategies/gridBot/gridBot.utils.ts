import { OrderSide } from '@models/order.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { checkOrderPrice } from '@utils/market/market.utils';
import { addPrecise } from '@utils/math/math.utils';
import { round } from '@utils/math/round.utils';
import { minBy } from 'lodash-es';
import { DEFAULT_AMOUNT_PRECISION, DEFAULT_PRICE_PRECISION, EMPTY_BALANCE } from './gridBot.const';
import { GridBotStrategyParams, GridBounds, GridSize, GridSpacingType, OutOfRangeSide, RebalancePlan } from './gridBot.types';

export const getPortfolioContent = (
  portfolio: Portfolio,
  base: string,
  quote: string,
): { asset: BalanceDetail; currency: BalanceDetail } => {
  const asset = portfolio.get(base) ?? { ...EMPTY_BALANCE };
  const currency = portfolio.get(quote) ?? { ...EMPTY_BALANCE };
  return { asset, currency };
};

/**
 * The maker fee of the market, a fraction (0.001 is 0.1 %), which a LIMIT order pays: the grid's orders and the STICKY rebalance's.
 * The simulator of backtests and paper trading charges it in currency, on top of a BUY (DummyCentralizedExchange.getLimitBuyCost) and
 * out of a SELL's proceeds: a BUY of `amount` at `price` needs amount × price × (1 + fee) of free currency, a SELL only its amount of
 * the asset. A live exchange that takes a BUY's fee from the asset bought, as Binance does, leaves what is set aside for it free. A
 * market that states no maker fee is taken to charge none, as the simulator takes it.
 */
export const getMakerFee = (marketData: MarketData): number => marketData.fee?.maker ?? 0;

/**
 * The price the rebalance order, planned at `price`, is placed at: GridBot places it as a STICKY order, which StickyOrder prices one
 * minimum price (price.min) above the bid for a BUY, below the ask for a SELL, the bid and the ask being that price here.
 */
export const getRebalanceOrderPrice = (side: OrderSide, price: number, marketData: MarketData): number => {
  const minimumPrice = marketData.price?.min ?? 0;
  return side === 'BUY' ? price + minimumPrice : price - minimumPrice;
};

/**
 * What a rebalance BUY of `amount`, planned at `price`, takes from the free currency: its STICKY order's price (see
 * getRebalanceOrderPrice), and the maker fee on top (see getMakerFee).
 */
export const getRebalanceBuyCost = (amount: number, price: number, marketData: MarketData): number =>
  amount * getRebalanceOrderPrice('BUY', price, marketData) * (1 + getMakerFee(marketData));

/**
 * A market limit is a bound only as a finite number above 0: Binance disables a filter bound by setting it to 0 (see market.utils). So
 * is a precision a step: a precision of 0 states none.
 */
const toBound = (limit?: number): number | undefined => (limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined);

/**
 * The step of numbers rounded to `decimals` decimals, one unit of the last: 1e-8 for 8. The step of the amounts (see
 * inferAmountPrecision), and of the prices when the market states no price step (see inferPricePrecision)
 */
const getDecimalStep = (decimals: number): number => Number(`1e-${decimals}`);

/**
 * The decimals of a number as String writes it, as round reads them: the fewest that round leaves the number as it is at. 2 for 0.01
 * and for 0.25, 8 for 1e-8, 0 for 1, for 10 and for a number that is not finite. Read through round, GridBot counts decimals as the
 * rest of the code does: a count of its own, the third in the code, gave a number that is not finite 8 decimals.
 */
const getDecimals = (value: number): number => {
  let decimals = 0;
  while (Number.isFinite(value) && round(value, decimals) !== value) decimals++;
  return decimals;
};

/**
 * The smallest amount of an order at `price` that the market takes: one amount step at least, amount.min and cost.min / price,
 * rounded up to the amount precision (see inferAmountPrecision). The simulator and CCXTExchange check the cost as amount × price in
 * floating point, which comes out one ulp under cost.min where the decimal product is exactly cost.min (0.00007 × 100000 is
 * 6.999999999999999): one step more is taken then.
 */
export const getMinimumAmount = (price: number, marketData: MarketData): number => {
  const amountDecimals = inferAmountPrecision(marketData);
  const step = getDecimalStep(amountDecimals);
  const minimumCost = toBound(marketData.cost?.min);
  const atCost = minimumCost && price > 0 ? minimumCost / price : 0;
  // Rounded up as -(the negated value rounded down): round has no ceiling
  const minimum = Math.max(step, -round(-Math.max(toBound(marketData.amount?.min) ?? 0, atCost), amountDecimals, 'down'));
  return minimumCost && minimum * price < minimumCost ? addPrecise(minimum, step) : minimum;
};

/**
 * The largest amount of an order at `price` that the market takes: amount.max and cost.max / price, rounded down to the amount
 * precision, one step less should the cost still come out over cost.max in floating point (0.00001 × 300000 is 3.0000000000000004).
 * Infinity when the market sets neither.
 */
export const getMaximumAmount = (price: number, marketData: MarketData): number => {
  const amountDecimals = inferAmountPrecision(marketData);
  const maximumCost = toBound(marketData.cost?.max);
  const atCost = maximumCost && price > 0 ? maximumCost / price : Infinity;
  const limit = Math.min(toBound(marketData.amount?.max) ?? Infinity, atCost);
  if (!Number.isFinite(limit)) return Infinity;
  const maximum = roundAmount(limit, amountDecimals);
  return maximumCost && maximum * price > maximumCost ? addPrecise(maximum, -getDecimalStep(amountDecimals)) : maximum;
};

/**
 * The precision of the market's prices: its tick (precision.price) and the decimals of that tick. A market that states no tick has its
 * prices rounded to DEFAULT_PRICE_PRECISION decimals, without a step, which the strategy warns of. The decimals used to be read from
 * the close then: a close of 100 put the prices of a grid spaced by 0.5 % at whole units, 99, 99, 100, 100, 101 and 101.
 */
export const inferPricePrecision = (marketData: MarketData): { priceDecimals: number; priceStep?: number } => {
  const priceStep = toBound(marketData.precision?.price);
  return priceStep ? { priceDecimals: getDecimals(priceStep), priceStep } : { priceDecimals: DEFAULT_PRICE_PRECISION };
};

/**
 * The decimals of the market's amount step (precision.amount), which the amounts are rounded down to: DEFAULT_AMOUNT_PRECISION for a
 * market that states no step
 */
export const inferAmountPrecision = (marketData: MarketData): number => {
  const amountStep = toBound(marketData.precision?.amount);
  return amountStep ? getDecimals(amountStep) : DEFAULT_AMOUNT_PRECISION;
};

/**
 * Rounds a price to the nearest multiple of the price step, a tie to the one above, as round does, or to `priceDecimals` decimals
 * without a step. The price is rounded as it is written: divided by the step in binary, a tie went the other way, 1.005 to 1 at a
 * step of 0.01, 1.005 / 0.01 being 100.49999999999999. A step of one unit of its last decimal (0.01), as exchanges state their tick,
 * rounds the price to those decimals. A step of several (0.05, 0.25) takes the nearest of the multiples around the binary quotient,
 * which can be one off, the distances measured in decimal. A price that is not a finite number is 0.
 */
export const roundPrice = (value: number, priceDecimals: number, priceStep?: number): number => {
  if (!Number.isFinite(value)) return 0;
  const step = toBound(priceStep);
  if (!step || step === getDecimalStep(priceDecimals)) return round(value, priceDecimals);

  const stepDecimals = getDecimals(step);
  const quotient = Math.round(value / step);
  // The higher first: the first of two equal distances is kept, a tie going to the multiple above
  const multiples = [quotient + 1, quotient, quotient - 1].map(multiple => round(multiple * step, stepDecimals));
  return minBy(multiples, multiple => Math.abs(addPrecise(value, -multiple)))!;
};

/**
 * Round amount to specified precision.
 */
export const roundAmount = (value: number, amountDecimals: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round(value, amountDecimals, 'down');
};

/**
 * Compute the price of the grid `levelIndex` steps away from the center price, based on spacing type: steps × spacingValue away for
 * fixed spacing, steps × spacingValue % of the center price away for percent spacing, arithmetic as fixed spacing is, and multiplied
 * or divided by (1 + spacingValue) once a step for logarithmic spacing, the one whose prices are a constant ratio apart.
 * @param centerPrice - The center price of the grid
 * @param levelIndex - Steps from the center price: negative below it, positive above, 0 for the center price itself
 * @param priceDecimals - Number of decimal places for rounding
 * @param spacingType - Type of spacing calculation
 * @param spacingValue - Spacing parameter value
 * @param priceStep - Optional price step for tick rounding
 */
export const computeLevelPrice = (
  centerPrice: number,
  levelIndex: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): number => {
  if (levelIndex === 0) return centerPrice;

  const steps = Math.abs(levelIndex);
  const direction = levelIndex > 0 ? 1 : -1;
  let price: number;

  // A fixed or percent price is computed in decimal, for roundPrice to round the price as it is written. Computed in binary, 100.1 +
  // 0.005 was 100.10499999999999 and 61235 × 1.005 was 61541.174999999996, rounded to 100.1 and 61541.17 where 100.105 and 61541.175
  // round to 100.11 and 61541.18. Each product is rounded to the decimals its exact value has at most, those of its factors and 2
  // more for a percent, then added in decimal.
  switch (spacingType) {
    case 'fixed':
      price = addPrecise(centerPrice, direction * round(spacingValue * steps, getDecimals(spacingValue)));
      break;
    case 'percent': {
      const decimals = getDecimals(centerPrice) + getDecimals(spacingValue) + 2;
      price = addPrecise(centerPrice, direction * round((centerPrice * spacingValue * steps) / 100, decimals));
      break;
    }
    // In binary: a power of the multiplier soon has more decimals than a number holds, and a division by it has no end of them
    case 'logarithmic': {
      const multiplier = 1 + spacingValue;
      if (multiplier <= 0) return 0;
      price = direction > 0 ? centerPrice * multiplier ** steps : centerPrice / multiplier ** steps;
      break;
    }
  }

  return roundPrice(price, priceDecimals, priceStep);
};

/**
 * The prices of the grid the parameters configure around the center price, rounded as its orders are (see computeLevelPrice): from
 * its lowest BUY to its highest SELL, the center price included. A level trades between two adjacent ones (see LevelState).
 */
export const computeGridPrices = (
  centerPrice: number,
  params: Pick<GridBotStrategyParams, 'buyLevels' | 'sellLevels' | 'spacingType' | 'spacingValue'>,
  priceDecimals: number,
  priceStep?: number,
): number[] => {
  const { buyLevels, sellLevels, spacingType, spacingValue } = params;
  return Array.from({ length: buyLevels + sellLevels + 1 }, (_, i) =>
    computeLevelPrice(centerPrice, i - buyLevels, priceDecimals, spacingType, spacingValue, priceStep),
  );
};

/**
 * Compute grid bounds (min and max prices) for the given configuration.
 */
export const computeGridBounds = (
  centerPrice: number,
  buyLevels: number,
  sellLevels: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  priceStep?: number,
): GridBounds | null => {
  if (buyLevels <= 0 && sellLevels <= 0) return null;

  const min = buyLevels > 0 ? computeLevelPrice(centerPrice, -buyLevels, priceDecimals, spacingType, spacingValue, priceStep) : centerPrice;
  const max =
    sellLevels > 0 ? computeLevelPrice(centerPrice, sellLevels, priceDecimals, spacingType, spacingValue, priceStep) : centerPrice;

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;

  return { min, max };
};

/**
 * The side of the grid a price is out on, below its lowest price or above its highest, null in range, the bounds included. Out on a
 * side, the price stays out on it until it is back at the grid's price next to that bound, `reentryPrices[side]`, where the grid trades
 * again once its orders beyond the bound have filled: counted back at the bound itself, a price hovering on it would be out and back
 * in at every other candle.
 */
export const getOutOfRangeSide = (
  price: number,
  bounds: GridBounds,
  reentryPrices: Record<OutOfRangeSide, number>,
  previous: OutOfRangeSide | null,
): OutOfRangeSide | null => {
  if (price < bounds.min) return 'below';
  if (price > bounds.max) return 'above';
  if (previous === 'below' && price < reentryPrices.below) return 'below';
  if (previous === 'above' && price > reentryPrices.above) return 'above';
  return null;
};

/**
 * Validate grid configuration against the center price, its lowest BUY included (see checkLowestBuyPrice), the exchange limits and
 * the price tick. The parameters themselves were checked by the schema (gridBot.schema.ts) before the strategy was created.
 * Returns an error message if invalid, null if valid.
 */
export const validateConfig = (params: GridBotStrategyParams, centerPrice: number, marketData: MarketData): string | null => {
  if (centerPrice <= 0) return 'Center price must be positive';

  const { priceDecimals, priceStep } = inferPricePrecision(marketData);

  const lowestBuyError = checkLowestBuyPrice(params, centerPrice, priceDecimals, priceStep);
  if (lowestBuyError) return lowestBuyError;

  // Against the exchange price limits, read as the order layer reads them for every order (see checkOrderPrice)
  const priceLimits = checkOrderPrice(centerPrice, marketData);
  if (!priceLimits.isValid) {
    const { min, max } = priceLimits;
    if (min !== undefined && centerPrice < min) return `Center price ${centerPrice} is below exchange minimum ${min}`;
    return `Center price ${centerPrice} is above exchange maximum ${max}`;
  }

  // Last, so that a configuration refused before keeps its message
  return checkPriceTick(params, centerPrice, priceDecimals, priceStep);
};

/**
 * Checks the lowest BUY of the grid the parameters configure around the center price, rounded as its order is (see
 * computeLevelPrice). The strategy refuses a grid whose lowest BUY is at or below 0 when it starts (see validateConfig), and again
 * around the price a rebalance ended at, where the grid is planned again or built. Only the start's center price used to be checked:
 * a fixed grid started with its lowest BUY a few ticks above 0, then rebalanced lower, was built without that level, with a warning
 * that blamed the free balances, or planned again without it, without a word. Percent and logarithmic BUYs, which scale with the
 * price, reach 0 only once rounded to the tick, after a far larger fall.
 * Returns an error message when the lowest BUY is at or below 0, null otherwise.
 */
export const checkLowestBuyPrice = (
  params: Pick<GridBotStrategyParams, 'buyLevels' | 'spacingType' | 'spacingValue'>,
  centerPrice: number,
  priceDecimals: number,
  priceStep?: number,
): string | null => {
  const { buyLevels, spacingType, spacingValue } = params;
  if (buyLevels <= 0) return null;
  const lowestBuyPrice = computeLevelPrice(centerPrice, -buyLevels, priceDecimals, spacingType, spacingValue, priceStep);
  if (lowestBuyPrice > 0) return null;
  return `Grid configuration would result in non-positive buy prices: the lowest of buyLevels ${buyLevels}, spaced by spacingValue ${spacingValue} (${spacingType}) below the center price ${centerPrice}, would be at ${lowestBuyPrice}`;
};

/**
 * Checks the prices of a grid against the price tick. Two adjacent ones that round to the same tick make a level that buys and sells at
 * that one price: two fees a round trip for nothing, and live, its SELL can meet a BUY of the grid at that price, which self-trade
 * prevention expires. A spacing under the tick used to be accepted: percent 0.001 at 100 put every price of a 3/3 grid at 100.
 * Returns an error message when two adjacent prices of the grid round to the same tick, null otherwise.
 */
export const checkPriceTick = (
  params: Pick<GridBotStrategyParams, 'buyLevels' | 'sellLevels' | 'spacingType' | 'spacingValue'>,
  centerPrice: number,
  priceDecimals: number,
  priceStep?: number,
): string | null => {
  const prices = computeGridPrices(centerPrice, params, priceDecimals, priceStep);
  const collision = prices.findIndex((price, i) => i > 0 && price <= prices[i - 1]);
  if (collision <= 0) return null;

  const spaced = `spaced by spacingValue ${params.spacingValue} (${params.spacingType}) around the center price ${centerPrice}`;
  const tick = priceStep ?? getDecimalStep(priceDecimals);
  return `Grid configuration would result in a level buying and selling at the same price: ${spaced}, two adjacent prices of the grid would both round to ${prices[collision]} at the price tick ${tick}`;
};

/**
 * A ratio as a percentage of four significant digits, for a message: 0.00016655 as 0.01666 %. With three, the round trip of a maker fee
 * of 0.04 %, 0.08003 %, read 0.08 %, and a warning of percent spacing 0.08 read as if 0.08 were under 0.08.
 */
const toPercent = (ratio: number): string => `${Number((ratio * 100).toPrecision(4))} %`;

/**
 * Checks the spacing against the round-trip fee. The round trip of a level, a BUY at its lower price then a SELL at its upper one,
 * pays the maker fee on both (see getMakerFee): it loses money when sellPrice × (1 - fee) < buyPrice × (1 + fee), a SELL less than
 * 2 × fee / (1 - fee) above its BUY. Such a grid is a bad one, not an impossible one as a grid with two prices at one tick is (see
 * checkPriceTick): it is warned of, not refused.
 * Returns a warning message when a level of the grid the parameters configure loses money at each round trip, null otherwise.
 */
export const checkRoundTripFee = (params: GridBotStrategyParams, centerPrice: number, marketData: MarketData): string | null => {
  const fee = getMakerFee(marketData);
  const { priceDecimals, priceStep } = inferPricePrecision(marketData);
  const prices = computeGridPrices(centerPrice, params, priceDecimals, priceStep);
  const levels = prices.slice(1).map((sellPrice, i) => ({ buyPrice: prices[i], sellPrice }));
  // A spacing under the round-trip fee used to be accepted without a word: at a maker fee of 0.0004, fixed 10 at 60000, 0.0167 % a
  // level, lost 0.038 USDT at each round trip of 0.001 BTC, and the more the grid traded, the more it lost
  const losing = levels.filter(({ buyPrice, sellPrice }) => sellPrice * (1 - fee) < buyPrice * (1 + fee));
  const narrowest = minBy(losing, ({ buyPrice, sellPrice }) => sellPrice / buyPrice);
  if (!narrowest) return null;

  const { buyPrice, sellPrice } = narrowest;
  const levelsUnder = `a level that sells less than ${toPercent((2 * fee) / (1 - fee))} above its buy`;
  const paying = `paying the maker fee of ${fee} (fee.maker) on its BUY and on its SELL`;
  const count = `${losing.length} out of ${levels.length} here`;
  const example = `the narrowest selling at ${sellPrice}, ${toPercent(sellPrice / buyPrice - 1)} above its buy at ${buyPrice}`;
  return `spacingValue ${params.spacingValue} (${params.spacingType}) is under the round-trip fee: ${levelsUnder}, ${paying}, loses money at each round trip, ${count}, ${example}`;
};

/**
 * The sums of the BUY prices of the grid from the center price down, one more level each, the first 0 for none: as far as the prices
 * are positive. The strategy plans and builds no grid with a BUY at or below 0 (see checkLowestBuyPrice), so it never reaches one.
 */
const getBuyPriceSums = (priceAt: (steps: number) => number, buyLevels: number): number[] => {
  const buyPriceSums = [0];
  for (let i = 1; i <= buyLevels; i++) {
    const price = priceAt(-i);
    if (price <= 0) break;
    buyPriceSums.push(buyPriceSums[i - 1] + price);
  }
  return buyPriceSums;
};

/**
 * What the grid the parameters configure takes on each side for one unit of the quantity every level trades, around the center
 * price: a unit of the asset for each sell level, and the price of each buy level in currency, the maker fee on top (see getMakerFee).
 * The grid the free balances fund is sized on these (see deriveLevelQuantity), and the rebalance aims at them (see
 * computeRebalancePlan).
 */
export const getGridFunding = (
  centerPrice: number,
  params: Pick<GridBotStrategyParams, 'buyLevels' | 'sellLevels' | 'spacingType' | 'spacingValue'>,
  marketData: MarketData,
): { asset: number; currency: number } => {
  const { buyLevels, sellLevels, spacingType, spacingValue } = params;
  const { priceDecimals, priceStep } = inferPricePrecision(marketData);
  const priceAt = (steps: number) => computeLevelPrice(centerPrice, steps, priceDecimals, spacingType, spacingValue, priceStep);
  const buyPriceSum = getBuyPriceSums(priceAt, buyLevels).at(-1)!;
  return { asset: Math.max(sellLevels, 0), currency: buyPriceSum * (1 + getMakerFee(marketData)) };
};

/**
 * Plans the rebalance after which the balances given, the free ones the grid is sized on, fund every level of the grid with the same
 * quantity: the split of getGridFunding, reached once the rebalance's STICKY order has traded at its own price, paying its fee (see
 * getRebalanceOrderPrice and getMakerFee). A portfolio on which the grid would leave less than 1 % of the value idle, what it holds of
 * one side beyond what the other side funds, is not rebalanced.
 * An order is at most the market's maximum (see getMaximumAmount). An amount under the market's minimum is left as it is (see
 * getMinimumAmount), for the strategy not to send it.
 * Returns null if the portfolio needs no rebalance.
 */
export const computeRebalancePlan = (
  centerPrice: number,
  assetFree: number,
  currencyFree: number,
  params: Pick<GridBotStrategyParams, 'buyLevels' | 'sellLevels' | 'spacingType' | 'spacingValue'>,
  marketData: MarketData,
): RebalancePlan | null => {
  if (centerPrice <= 0) return null;
  const totalValue = assetFree * centerPrice + currencyFree;
  if (totalValue <= 0) return null;

  // The rebalance used to aim at sellLevels / (buyLevels + sellLevels) of the value in the asset, 50/50 for a symmetric grid. The
  // BUYs, below the center price, cost less than the SELLs are worth, and the grid is sized on the scarcer side: from 3 % of the
  // currency for 5/5 levels spaced by 1 % to 21 % for 20/20 spaced by 2 % stayed idle for the whole run.
  const funding = getGridFunding(centerPrice, params, marketData);
  // Above 0, the currency funds more of the quantity than the asset does: currency / funding.currency > asset / funding.asset
  const imbalance = funding.asset * currencyFree - funding.currency * assetFree;
  if (imbalance === 0) return null;
  const side: OrderSide = imbalance > 0 ? 'BUY' : 'SELL';

  // What the grid would leave idle on the portfolio as it is: the currency its BUYs do not need, or the asset its SELLs do not.
  // Measured on the amount the rebalance trades, as it used to be, the 1 % tolerance let a lopsided grid idle many times more: 5 %
  // of the value on 9/1 levels, for a BUY of 0.5 %.
  const idleValue = side === 'BUY' ? imbalance / funding.asset : (-imbalance / funding.currency) * centerPrice;
  if (idleValue < 0.01 * totalValue) return null;

  // The quantity both sides fund once the rebalance has traded at the price of its STICKY order, paying its fee, and the amount that
  // takes. A BUY is reckoned on the currency it spends and a SELL on the asset it sells, so that in floating point a sell-only grid
  // buys no more than the currency pays, as the simulator checks it, and a buy-only grid sells its whole asset, not a step less. A
  // sell-only grid's BUY of the whole currency at the center price used to be refused at every attempt, its order placed one minimum
  // price above the bid and the fee on top, and the run stopped before any grid was built.
  const sellProceeds = getRebalanceOrderPrice('SELL', centerPrice, marketData) * (1 - getMakerFee(marketData));
  const unitValue = side === 'BUY' ? getRebalanceBuyCost(1, centerPrice, marketData) : sellProceeds;
  const quantity = (currencyFree + assetFree * unitValue) / (funding.currency + funding.asset * unitValue);
  const gap = side === 'BUY' ? (currencyFree - funding.currency * quantity) / unitValue : assetFree - funding.asset * quantity;

  // Rounded down to the amount precision, at most the market's maximum. An amount under amount.min used to be raised to it, beyond
  // what the gap called for and what the balances paid: a rebalance under the market's minimum is no order to send
  const amountDecimals = inferAmountPrecision(marketData);
  const orderPrice = getRebalanceOrderPrice(side, centerPrice, marketData);
  const amount = Math.min(roundAmount(gap, amountDecimals), getMaximumAmount(orderPrice, marketData));

  if (amount <= 0) return null;

  return {
    side,
    amount,
    estimatedNotional: amount * centerPrice,
    centerPrice,
  };
};

/**
 * Sizes the grid on the free balances: the quantity every order of the grid trades, and the levels it funds, the nearest to the
 * center price. Every order is placed at or above the lowest price of the grid, so a quantity of at least the market's minimum there
 * (see getMinimumAmount) is one the market takes for every order. A side whose free balance cannot fund each of its levels with that
 * minimum keeps the levels it funds and leaves out the farthest: none at all for a side that funds no level.
 * - A SELL needs its amount of the asset: the sell levels share the free asset.
 * - A BUY needs its cost with the maker fee on top (see getMakerFee): the buy levels share the free currency in proportion to their
 *   prices. Sized on the prices alone, the BUYs needed the whole free currency before their fees: the simulator refused the last one
 *   placed, the highest, at every attempt.
 * The quantity is the smaller of the two shares, rounded down to the amount precision, at most the market's maximum at the highest
 * price of the grid (see getMaximumAmount): 0, with no level, when the free balances fund none. What the larger share holds beyond
 * it stays idle, which the rebalance avoids (see computeRebalancePlan).
 */
export const deriveLevelQuantity = (
  centerPrice: number,
  assetFree: number,
  currencyFree: number,
  buyLevels: number,
  sellLevels: number,
  priceDecimals: number,
  spacingType: GridSpacingType,
  spacingValue: number,
  marketData: MarketData,
  priceStep?: number,
): GridSize => {
  const priceAt = (steps: number) => computeLevelPrice(centerPrice, steps, priceDecimals, spacingType, spacingValue, priceStep);
  const amountDecimals = inferAmountPrecision(marketData);

  const buyPriceSums = getBuyPriceSums(priceAt, buyLevels);
  const currencyShare = (levels: number) => (levels > 0 ? currencyFree / (buyPriceSums[levels] * (1 + getMakerFee(marketData))) : Infinity);
  const assetShare = (levels: number) => (levels > 0 ? assetFree / levels : Infinity);
  // The market minimum at the lowest price of a grid of `levels` buy levels: its lowest BUY, or without any the center price, where
  // the first sell level buys once it has sold
  const minimumAt = (levels: number) => getMinimumAmount(levels > 0 ? priceAt(-levels) : centerPrice, marketData);

  // The quantity used to be raised to amount.min, or to cost.min at the lowest price, beyond what the balances funded, and left
  // unrounded: the last orders placed were refused for want of funds, and CCXTExchange truncated the others to the amount step,
  // under cost.min again, so that a small account had most of its levels refused at every attempt
  let fundedBuyLevels = buyPriceSums.length - 1;
  while (fundedBuyLevels > 0 && roundAmount(currencyShare(fundedBuyLevels), amountDecimals) < minimumAt(fundedBuyLevels)) fundedBuyLevels--;
  const minimumAmount = minimumAt(fundedBuyLevels);
  let fundedSellLevels = Math.max(sellLevels, 0);
  while (fundedSellLevels > 0 && roundAmount(assetShare(fundedSellLevels), amountDecimals) < minimumAmount) fundedSellLevels--;

  if (fundedBuyLevels === 0 && fundedSellLevels === 0) return { quantity: 0, buyLevels: 0, sellLevels: 0, minimumAmount };

  const share = roundAmount(Math.min(assetShare(fundedSellLevels), currencyShare(fundedBuyLevels)), amountDecimals);
  // At most the market maximum at the highest price of the grid: its highest SELL, or without any the center price, where the first
  // buy level sells once it has bought
  const quantity = Math.min(share, getMaximumAmount(priceAt(fundedSellLevels), marketData));
  return { quantity, buyLevels: fundedBuyLevels, sellLevels: fundedSellLevels, minimumAmount };
};

/**
 * Check if only one side has active orders (for warning purposes). It reads the side of each level holding an order, which is the
 * side of that order: fills change it.
 */
export const hasOnlyOneSide = (levels: Array<{ side: 'BUY' | 'SELL'; orderId?: string }>): boolean => {
  let hasBuy = false;
  let hasSell = false;

  for (const level of levels) {
    if (!level.orderId) continue;
    if (level.side === 'BUY') hasBuy = true;
    else hasSell = true;
    if (hasBuy && hasSell) return false;
  }

  return hasBuy || hasSell;
};

/**
 * Whether an order error leaves the outcome of the order unknown: it may be live on the exchange, while the Trader, which forgets an
 * order once it errored, tracks it no more. Read from the reason as the order layer and CCXTExchange word it, "Outcome unknown: the
 * order may be live on the exchange" for a creation lost on the network (Order.toCreationError) and "the order may exist on the
 * exchange" for a creation answered with neither a status nor an id, since the event carries no field saying so. An error worded by
 * the exchange itself is not recognised, such as a poll that failed for good once the order was live.
 */
export const isOutcomeUnknown = (reason: string): boolean => /the order may (?:be live|exist) on the exchange/i.test(reason);
