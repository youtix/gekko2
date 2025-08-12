import Yup from 'yup';
import {
  configurationSchema,
  exchangeSchema,
  storageSchema,
  watchSchema,
} from '../../services/configuration/configuration.schema';

export type Watch = Yup.InferType<typeof watchSchema>;
export type StorageConfig = Yup.InferType<typeof storageSchema>;
export type ExchangeConfig = Yup.InferType<typeof exchangeSchema>;
export type Configuration = Yup.InferType<typeof configurationSchema>;
