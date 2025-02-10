import { find } from 'lodash-es';
import { array, boolean, number, object, string } from 'yup';

export const watchSchema = object({
  exchange: string().oneOf(['binance']).required(),
  currency: string().required(),
  asset: string().required(),
  tickrate: number().optional(),
  mode: string().oneOf(['realtime', 'backtest', 'importer']).defined(),
  daterange: object({
    start: string().datetime().required(),
    end: string().datetime().required(),
  }).when(['mode', 'scan'], {
    is: (mode: string, scan: boolean) => mode === 'importer' || (mode === 'backtest' && !scan),
    then: (schema) => schema.required(),
    otherwise: (schema) => schema.default(null).notRequired(),
  }),
  scan: boolean().notRequired(),
  batchSize: number().notRequired(),
});

export const storageSchema = object({
  type: string().oneOf(['sqlite']).defined(),
  database: string().required(),
});

export const disclaimerSchema = object({
  content: string()
    .oneOf(['I understand that Gekko only automates MY OWN trading strategies'])
    .notRequired(),
  isDisclaimerRead: boolean().notRequired(),
});

const pluginSchema = object({
  name: string().required(),
});

export const configurationSchema = object({
  watch: watchSchema,
  storage: storageSchema.default(null).notRequired(),
  plugins: array().of(pluginSchema).required(),
  strategy: object({ name: string().notRequired() }),
  disclaimer: disclaimerSchema,
})
  .test('disclaimer-read-check', ({ plugins, disclaimer }, { createError }) => {
    if (find(plugins, { name: 'trader' }) && !disclaimer?.isDisclaimerRead) {
      return createError({
        path: 'disclaimer.isDisclaimerRead',
        message: [
          'Do you understand what Gekko will do with your money ?',
          'Read this first: https://github.com/askmike/gekko/issues/201',
        ].join(' '),
      });
    }
    return true;
  })
  .test('disclaimer-content-check', ({ plugins, disclaimer }, { createError }) => {
    if (find(plugins, { name: 'trader' }) && !disclaimer?.content) {
      return createError({
        path: 'disclaimer.content',
        message: [
          'You need to write the following disclaimer in the config file:',
          'I understand that Gekko only automates MY OWN trading strategies',
        ].join(' '),
      });
    }
    return true;
  });
