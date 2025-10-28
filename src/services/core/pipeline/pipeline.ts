import { GekkoError } from '@errors/gekko.error';
import { PipelineContext } from '@models/pipeline.types';
import * as pluginList from '@plugins/index';
import { PluginsNames } from '@plugins/plugin.types';
import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { debug } from '@services/logger';
import { keepDuplicates } from '@utils/array/array.utils';
import { toCamelCase } from '@utils/string/string.utils';
import { compact, each, filter, flatMap, map, some } from 'lodash-es';
import { PluginsEmitSameEventError } from './pipeline.error';
import { streamPipelines } from './pipeline.utils';

export const launchStream = async (context: PipelineContext) => {
  const plugins = compact(map(context, p => p.plugin));
  await streamPipelines[config.getWatch().mode](plugins);
  return context;
};

export const initPlugins = async (context: PipelineContext) => {
  await Promise.all(context.map(pipeline => pipeline.plugin?.processInitStream()));
  return context;
};

export const injectServices = async (context: PipelineContext) =>
  each(context, pipeline => {
    each(pipeline.inject, async serviceName => {
      // @ts-expect-error TODO fix complex typescript error
      pipeline.plugin[toCamelCase('set', serviceName)](inject[serviceName]());
    });
  });

export const wirePlugins = async (context: PipelineContext) => {
  const emitters = filter(context, ({ eventsEmitted }) => !!eventsEmitted?.length);

  return each(context, ({ plugin: handler, name: handlerName, eventsHandlers }) => {
    each(emitters, ({ eventsEmitted, plugin: emitter, name: emitterName }) => {
      if (handlerName === emitterName) return;
      each(eventsEmitted, event => {
        const eventHandler = toCamelCase('on', event);
        if (eventsHandlers?.includes(eventHandler)) {
          // @ts-expect-error TODO fix complex typescript error
          emitter?.on(event, handler[eventHandler].bind(handler));
          debug('pipeline', `When ${emitterName} emit '${event}', ${handlerName}.${eventHandler} will be executed.`);
        }
      });
    });
  });
};

export const createPlugins = async (context: PipelineContext) =>
  map(context, pluginCtx => {
    const { name, parameters } = pluginCtx;
    const PluginClass = pluginList[name as PluginsNames];
    // @ts-expect-error TODO fix complex typescript error
    const plugin = new PluginClass(parameters);
    debug('pipeline', `${name} plugin created !`);
    return { ...pluginCtx, plugin };
  });

export const preloadMarkets = async (context: PipelineContext) => {
  const { mode } = config.getWatch();
  const isPreloadMarketNeeded =
    ['realtime', 'importer'].includes(mode) || some(context, plugin => plugin.inject?.includes('exchange'));
  if (isPreloadMarketNeeded) {
    const exchange = inject.exchange();
    debug('pipeline', `Preloading Markets data for ${exchange.getExchangeName()}`);
    await exchange.loadMarkets();
  }
  return context;
};

export const checkPluginsDuplicateEvents = async (context: PipelineContext) => {
  const eventsByPlugin = map(context, ({ name, eventsEmitted }) => ({
    name,
    events: eventsEmitted ?? [],
  }));

  const duplicateEvents = keepDuplicates(compact(flatMap(eventsByPlugin, p => p.events)));
  const duplicatePlugins = map(
    filter(eventsByPlugin, ({ events }) => events.some(e => duplicateEvents.includes(e))),
    p => p.name,
  );

  if (duplicateEvents.length) throw new PluginsEmitSameEventError(duplicatePlugins, duplicateEvents);
  return context;
};

export const checkPluginsDependencies = async (context: PipelineContext) => {
  for (const plugin of context) {
    for (const dependency of plugin.dependencies ?? []) {
      try {
        await import(dependency);
      } catch {
        throw new GekkoError('pipeline', `Dependency ${dependency} not installed for plugin ${plugin.name}`);
      }
    }
  }
  return context;
};

export const validatePluginsSchema = async (context: PipelineContext) => {
  const parameters = config.getPlugins();
  return map(context, (plugin, i) => ({
    ...plugin,
    parameters: plugin.schema?.parse(parameters[i]),
  }));
};

export const checkPluginsModesCompatibility = async (context: PipelineContext) =>
  each(context, ({ name, modes }) => {
    const mode = config.getWatch().mode;
    if (!modes?.includes(mode)) throw new GekkoError('pipeline', `Plugin ${name} does not support ${mode} mode.`);
  });

export const getPluginsStaticConfiguration = async (context: PipelineContext) =>
  map(context, plugin => {
    const PluginClass = pluginList[plugin.name as PluginsNames];
    const { modes, schema, dependencies, eventsEmitted, name, eventsHandlers, inject } =
      PluginClass.getStaticConfiguration();
    return { modes, schema, dependencies, eventsEmitted, name, eventsHandlers, inject };
  });

export const gekkoPipeline = () =>
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
