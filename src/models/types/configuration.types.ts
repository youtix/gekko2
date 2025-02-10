import Yup from 'yup';
import {
  brokerSchema,
  configurationSchema,
  storageSchema,
  watchSchema,
} from '../schema/configuration.schema';

export type Watch = Yup.InferType<typeof watchSchema>;
export type StorageConfig = Yup.InferType<typeof storageSchema>;
export type BrokerConfig = Yup.InferType<typeof brokerSchema>;
export type Configuration = Yup.InferType<typeof configurationSchema>;
