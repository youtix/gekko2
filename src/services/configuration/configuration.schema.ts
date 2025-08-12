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

export const exchangeSchema = object({
  name: string().oneOf(['binance']).required(),
  interval: number().positive().notRequired(),
  sandbox: boolean().default(false),
  key: string().notRequired(),
  secret: string().notRequired(),
  verbose: boolean().default(false),
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
