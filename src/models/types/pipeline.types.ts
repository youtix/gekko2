import { Plugin } from '@plugins/plugin';

export type PipelineContext = {
  name: string;
  plugin?: Plugin;
  eventsEmitted?: string[];
  eventsHandlers?: string[];
  dependencies?: string[];
  inject?: string[];
}[];
