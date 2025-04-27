import { TrailingStop } from '@services/core/order/trailingStop';
import * as plugins from './index';

export type PluginsNames = keyof typeof plugins;
export type PluginsDefinition = (args: ConstructorParameters<(typeof plugins)[PluginsNames]>) => typeof plugins;

export type ActiveStopTrigger = {
  id: string;
  adviceId: string;
  instance: TrailingStop;
};
