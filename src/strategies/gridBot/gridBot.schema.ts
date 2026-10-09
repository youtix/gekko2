import { z } from 'zod';
import { DEFAULT_RETRY_LIMIT } from './gridBot.const';

// The strategy block, without name, as the StrategyManager parses it before the strategy is created. It used to reach GridBot
// unchecked: a misspelt buyLevel built a grid of SELLs only, buyLevels: 2.5 placed BUYs off the prices they were sized on, and a
// quoted logarithmic spacingValue ('0.01') was concatenated into a multiplier of 10.01.
export const gridBotStrategySchema = z
  .strictObject({
    /**
     * Number of buy levels below the center price. The lowest must stay above 0: a grid whose lowest BUY would be at or below 0 stops
     * the run, when it starts and again around the price a rebalance ended at
     */
    buyLevels: z.int().min(0),
    /** Number of sell levels above the center price */
    sellLevels: z.int().min(0),
    /** How the levels are spaced apart */
    spacingType: z.enum(['percent', 'fixed', 'logarithmic']),
    /**
     * Distance between adjacent prices of the grid:
     * - percent: a percentage of the center price (1 === 1 %), the same between any two adjacent prices, as fixed spacing is: 10
     *   around 100 puts the prices at 50, 60, … 150, so that 50 to 60 is +20 % and 140 to 150 +7 %
     * - fixed: price units
     * - logarithmic: the ratio between adjacent prices, less 1 (0.01 === each price 1 % above the one below it)
     * Checked against the market around the center price: a spacing that rounds two adjacent prices of the grid to the same price tick
     * stops the run, when the grid starts or once it is rebalanced, and one under the round-trip fee, two maker fees, is warned of once.
     */
    spacingValue: z.number().positive(),
    /**
     * Retries of a refused or canceled order before the strategy gives up on it: a grid order is then left out with a warning, the
     * rest of the grid trading on until no level holds an order, and a rebalance stops the run. An order whose outcome is unknown,
     * which may be live on the exchange, is never retried: the run stops once more grid orders than this are in that case. At least
     * 1: the strategy used to raise a 0 to 1 without a word.
     */
    retryOnError: z.int().min(1).default(DEFAULT_RETRY_LIMIT),
  })
  .refine(({ buyLevels, sellLevels }) => buyLevels + sellLevels > 0, {
    message: 'buyLevels and sellLevels cannot both be 0: the grid needs at least one level',
  });
