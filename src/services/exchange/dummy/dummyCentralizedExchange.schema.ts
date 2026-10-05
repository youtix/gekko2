import { symbolSchema } from '@models/schema/pairConfig.schema';
import { TradingPair } from '@models/utility.types';
import { exchangeSchema, feeRateSchema, simulationBalanceSchema } from '@services/exchange/exchange.schema';
import z from 'zod';
import { MarketData, Ticker } from '../exchange.types';

const nonNegativeNumberSchema = (field: string) => {
  const message = `${field} must be a number of at least 0`;
  return z.number(message).min(0, message);
};

const positiveNumberSchema = (field: string) => {
  const message = `${field} must be a number greater than 0`;
  return z.number(message).positive(message);
};

/**
 * The lowest and highest order price, amount or cost of a pair. A max left out, or set to 0 as Binance reports a disabled
 * filter, sets no maximum (market.utils counts a bound of 0 as absent), so min is only compared with a max above 0.
 * Zod still runs the refinement after a failed bound: a negative max, already reported, is not compared either.
 */
const limitRangeSchema = (field: string) =>
  z
    .object({
      min: nonNegativeNumberSchema(`${field}.min`),
      max: nonNegativeNumberSchema(`${field}.max`).optional(),
    })
    .refine(({ min, max }) => max === undefined || max <= 0 || min <= max, {
      message: `${field}.min must not exceed ${field}.max (leave max out for no maximum)`,
    });

/**
 * The quote of a pair until its first candle. Zod still runs the refinement after a failed bound: an ask of 0 or below,
 * already reported, is not compared.
 */
const tickerSchema = z
  .object({
    bid: positiveNumberSchema('ticker.bid'),
    ask: positiveNumberSchema('ticker.ask'),
  })
  .refine(({ bid, ask }) => ask <= 0 || bid <= ask, { message: 'ticker.bid must not exceed ticker.ask' });

const marketDataSchema = z
  .array(
    z.object({
      symbol: symbolSchema,
      marketData: z.object({
        price: limitRangeSchema('price'),
        amount: limitRangeSchema('amount'),
        cost: limitRangeSchema('cost'),
        precision: z.object({
          price: nonNegativeNumberSchema('precision.price'),
          amount: nonNegativeNumberSchema('precision.amount'),
        }),
        fee: z.object({
          maker: feeRateSchema('fee.maker'),
          taker: feeRateSchema('fee.taker'),
        }),
      }),
    }),
  )
  .default([])
  .transform(marketConstraints => new Map<TradingPair, MarketData>(marketConstraints?.map(mc => [mc.symbol, mc.marketData]) ?? []));

const initialTickerSchema = z
  .array(
    z.object({
      symbol: symbolSchema,
      ticker: tickerSchema,
    }),
  )
  .default([])
  .transform(balance => new Map<TradingPair, Ticker>(balance.map(b => [b.symbol, b.ticker])));

export const dummyExchangeSchema = exchangeSchema.extend({
  name: z.literal('dummy-cex'),
  simulationBalance: simulationBalanceSchema,
  marketData: marketDataSchema,
  initialTicker: initialTickerSchema,
});
