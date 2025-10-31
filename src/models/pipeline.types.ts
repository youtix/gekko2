import { Plugin } from '@plugins/plugin';
import { z } from 'zod';
import { Nullable } from './utility.types';

export type PipelineContext = {
  name: string;
  plugin?: Plugin;
  parameters?: { name?: Nullable<string> };
  eventsEmitted?: string[];
  eventsHandlers?: string[];
  dependencies?: string[];
  inject?: string[];
  modes?: string[];
  schema?: z.ZodTypeAny;
}[];
