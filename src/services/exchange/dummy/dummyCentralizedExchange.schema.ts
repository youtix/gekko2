import { symbolSchema } from '@models/schema/pairConfig.schema';
import { Symbol } from '@models/utility.types';
import { exchangeSchema, simulationBalanceSchema } from '@services/exchange/exchange.schema';
import z from 'zod';
import { MarketData, Ticker } from '../exchange.types';

const marketDataSchema = z
  .array(
    z.object({
      symbol: symbolSchema,
      marketData: z.object({
        price: z.object({
          min: z.number(),
          max: z.number(),
        }),
        amount: z.object({
          min: z.number(),
          max: z.number(),
        }),
        cost: z.object({
          min: z.number(),
          max: z.number(),
        }),
        precision: z.object({
          price: z.number(),
          amount: z.number(),
        }),
        fee: z.object({
          maker: z.number(),
          taker: z.number(),
        }),
      }),
    }),
  )
  .default([])
  .transform(
    marketConstraints => new Map<Symbol, MarketData>(marketConstraints?.map(mc => [mc.symbol, mc.marketData]) ?? []),
  );

const initialTickerSchema = z
  .array(
    z.object({
      symbol: symbolSchema,
      ticker: z.object({
        bid: z.number(),
        ask: z.number(),
      }),
    }),
  )
  .default([])
  .transform(balance => new Map<Symbol, Ticker>(balance.map(b => [b.symbol, b.ticker])));

export const dummyExchangeSchema = exchangeSchema.extend({
  name: z.literal('dummy-cex'),
  simulationBalance: simulationBalanceSchema,
  marketData: marketDataSchema,
  initialTicker: initialTickerSchema,
});
