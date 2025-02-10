import { config } from '@services/configuration/configuration';
import {
  checkPluginsDependencies,
  checkPluginsDuplicateEvents,
  checkPluginsModesCompatibility,
  createPlugins,
  getPluginsStaticConfiguration,
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
    launchStream,
  ].reduce(async (params, fn) => fn(await params), Promise.resolve(config.getPlugins()));
};
