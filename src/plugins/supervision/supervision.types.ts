import Yup from 'yup';
import { supervisionSchema } from './supervision.schema';

export type SupervisionConfig = Yup.InferType<typeof supervisionSchema>;
