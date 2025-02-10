import { config } from '@services/configuration/configuration';
import {
  checkDependencies,
  checkDuplicateEvents,
  createPlugins,
  injectServices,
  launchStream,
  wirePlugins,
} from '@utils/pipeline/pipeline.utils';

export const pipeline = () => {
  [
    createPlugins,
    checkDependencies,
    checkDuplicateEvents,
    wirePlugins,
    injectServices,
    launchStream,
  ].reduce(async (params, fn) => fn(await params), Promise.resolve(config.getPlugins()));
};
