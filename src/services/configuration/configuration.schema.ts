import { some } from 'lodash-es';
import { array, boolean, number, object, string } from 'yup';
import { TIMEFRAMES } from './configuration.const';

const daterangeSchema = object({
  start: string().datetime().required(),
  end: string().datetime().required(),
}).when(['mode', 'scan'], {
  is: (mode: string, scan: boolean) => mode === 'importer' || (mode === 'backtest' && !scan),
  then: schema => schema.required(),
  otherwise: schema => schema.default(null).notRequired(),
});

const warmupSchema = object({
  tickrate: number().default(1000),
  candleCount: number().default(0),
});

const simulationBalanceSchema = object({
  asset: number().min(0).default(0),
  currency: number().min(0).default(1000),
});

export const watchSchema = object({
  currency: string().required(),
  asset: string().required(),
  tickrate: number().default(1000),
  mode: string().oneOf(['realtime', 'backtest', 'importer']).defined(),
  timeframe: string().oneOf(TIMEFRAMES).default('1m'),
  fillGaps: string().oneOf(['no', 'empty']).default('empty'),
  warmup: warmupSchema,
  daterange: daterangeSchema,
  scan: boolean().notRequired(),
  batchSize: number().notRequired(),
});

const baseExchangeSchema = object({
  name: string().oneOf(['binance', 'dummy-cex']).required(),
  interval: number().positive().notRequired(),
  sandbox: boolean().default(false),
  key: string().notRequired(),
  secret: string().notRequired(),
  verbose: boolean().default(false),
}).shape({
  simulationBalance: simulationBalanceSchema.default(undefined).notRequired(),
  feeMaker: number().positive().default(undefined).notRequired(),
  feeTaker: number().positive().default(undefined).notRequired(),
});

export const exchangeSchema = baseExchangeSchema.when('name', {
  is: (name: string) => ['dummy-cex'].includes(name),
  then: schema =>
    schema.shape({
      simulationBalance: simulationBalanceSchema.default(() => ({ asset: 0, currency: 1000 })).required(),
      feeMaker: number().positive().default(0.15).required(),
      feeTaker: number().positive().default(0.25).required(),
    }),
  otherwise: schema =>
    schema.shape({
      simulationBalance: simulationBalanceSchema.default(undefined).notRequired(),
      feeMaker: number().positive().default(undefined).notRequired(),
      feeTaker: number().positive().default(undefined).notRequired(),
    }),
});

export const storageSchema = object({
  type: string().oneOf(['sqlite']).defined(),
  database: string().required(),
  insertThreshold: number().notRequired(),
});

const pluginSchema = object({
  name: string().required(),
});

const disclaimerSchema = boolean().when(['plugins'], {
  is: (plugins: { name: string }[]) => some(plugins, { name: 'trader' }),
  then: schema => schema.isTrue().required(),
  otherwise: schema => schema.default(null).notRequired(),
});

export const configurationSchema = object({
  showLogo: boolean().default(true),
  watch: watchSchema,
  exchange: exchangeSchema.default(null).notRequired(),
  storage: storageSchema.default(null).notRequired(),
  plugins: array().of(pluginSchema).required(),
  strategy: object({ name: string().notRequired() }),
  'I understand that Gekko only automates MY OWN trading strategies': disclaimerSchema,
});
