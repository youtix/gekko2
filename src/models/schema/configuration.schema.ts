import { some } from 'lodash-es';
import { array, boolean, number, object, string } from 'yup';

export const watchSchema = object({
  currency: string().required(),
  asset: string().required(),
  tickrate: number().optional(),
  mode: string().oneOf(['realtime', 'backtest', 'importer']).defined(),
  fillGaps: string().oneOf(['no', 'empty']).default('no'),
  daterange: object({
    start: string().datetime().required(),
    end: string().datetime().required(),
  }).when(['mode', 'scan'], {
    is: (mode: string, scan: boolean) => mode === 'importer' || (mode === 'backtest' && !scan),
    then: schema => schema.required(),
    otherwise: schema => schema.default(null).notRequired(),
  }),
  scan: boolean().notRequired(),
  batchSize: number().notRequired(),
});

export const brokerSchema = object({
  name: string().oneOf(['binance', 'bitfinex']).required(),
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
  broker: brokerSchema.default(null).notRequired(),
  storage: storageSchema.default(null).notRequired(),
  plugins: array().of(pluginSchema).required(),
  strategy: object({ name: string().notRequired() }),
  'I understand that Gekko only automates MY OWN trading strategies': disclaimerSchema,
});
