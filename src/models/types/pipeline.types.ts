import { Plugin } from '@plugins/plugin';
import { Schema } from 'yup';
import { Nullable } from './generic.types';

export type PipelineContext = {
  name: string;
  plugin?: Plugin;
  parameters?: { name?: Nullable<string> };
  eventsEmitted?: string[];
  eventsHandlers?: string[];
  dependencies?: string[];
  inject?: string[];
  modes?: string[];
  schema?: Schema;
}[];
