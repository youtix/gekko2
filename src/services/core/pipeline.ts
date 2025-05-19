import { config } from '@services/configuration/configuration';
import {
  checkPluginsDependencies,
  checkPluginsDuplicateEvents,
  checkPluginsModesCompatibility,
  createPlugins,
  getPluginsStaticConfiguration,
  initPlugins,
  injectServices,
  launchStream,
  preloadMarkets,
  validatePluginsSchema,
  wirePlugins,
} from '@utils/pipeline/pipeline.utils';

export const pipeline = () => {
  [
    getPluginsStaticConfiguration,
    checkPluginsModesCompatibility,
    validatePluginsSchema,
    checkPluginsDependencies,
    checkPluginsDuplicateEvents,
    preloadMarkets,
    createPlugins,
    wirePlugins,
    injectServices,
    initPlugins,
    launchStream,
  ].reduce(async (params, fn) => fn(await params), Promise.resolve(config.getPlugins()));
};
