import Yup from 'yup';
import { configurationSchema, storageSchema, watchSchema } from '../schema/configuration.schema';

export type Watch = Yup.InferType<typeof watchSchema>;
export type Storage = Yup.InferType<typeof storageSchema>;
export type Configuration = Yup.InferType<typeof configurationSchema>;
