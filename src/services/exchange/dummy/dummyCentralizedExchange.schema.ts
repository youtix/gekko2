import { DEFAULT_MARKET_DATA, DEFAULT_SIMULATION_BALANCE } from '@services/exchange/exchange.const';
import { exchangeSchema } from '@services/exchange/exchange.schema';
import z from 'zod';
import { DEFAULT_TICKER } from './dummyCentralizedExchange.const';

const simulationBalanceSchema = z
  .object({
    asset: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.asset),
    currency: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.currency),
  })
  .default(DEFAULT_SIMULATION_BALANCE);

const marketDataSchema = z
  .object({
    price: z.object({
      min: z.number().default(DEFAULT_MARKET_DATA.price.min),
      max: z.number().default(DEFAULT_MARKET_DATA.price.max),
    }),
    amount: z.object({
      min: z.number().default(DEFAULT_MARKET_DATA.amount.min),
      max: z.number().default(DEFAULT_MARKET_DATA.amount.max),
    }),
    cost: z.object({
      min: z.number().default(DEFAULT_MARKET_DATA.cost.min),
      max: z.number().default(DEFAULT_MARKET_DATA.cost.max),
    }),
    precision: z.object({
      price: z.number().default(DEFAULT_MARKET_DATA.precision.price),
      amount: z.number().default(DEFAULT_MARKET_DATA.precision.amount),
    }),
    fee: z.object({
      maker: z.number().default(DEFAULT_MARKET_DATA.fee.maker),
      taker: z.number().default(DEFAULT_MARKET_DATA.fee.taker),
    }),
  })
  .default(DEFAULT_MARKET_DATA);

const initialTickerSchema = z
  .object({
    bid: z.number().default(DEFAULT_TICKER.bid),
    ask: z.number().default(DEFAULT_TICKER.ask),
  })
  .default(DEFAULT_TICKER);

export const dummyExchangeSchema = exchangeSchema.extend({
  name: z.literal('dummy-cex'),
  simulationBalance: simulationBalanceSchema,
  marketData: marketDataSchema,
  initialTicker: initialTickerSchema,
});
