import { NoDaterangeFoundError } from '@errors/backtest/NoDaterangeFound.error';
import { PluginMissingDependencyError } from '@errors/plugin/pluginMissingDependency.error';
import { PluginsEmitSameEventError } from '@errors/plugin/pluginsEmitSameEvent.error';
import { PluginUnsupportedModeError } from '@errors/plugin/pluginUnsupportedMode.error';
import { PipelineContext } from '@models/types/pipeline.types';
import * as pluginList from '@plugins/index';
import { PluginsNames } from '@plugins/plugin.types';
import { config } from '@services/configuration/configuration';
import { BacktestStream } from '@services/core/stream/backtest.stream';
import { GapFillerStream } from '@services/core/stream/gapFiller/gapFiller.stream';
import { ImporterStream } from '@services/core/stream/importer/importer.stream';
import { PluginsStream } from '@services/core/stream/plugins.stream';
import { RealtimeStream } from '@services/core/stream/realtime.stream';
import { inject } from '@services/injecter/injecter';
import { debug } from '@services/logger';
import { keepDuplicates } from '@utils/array/array.utils';
import { toISOString, toTimestamp } from '@utils/date/date.utils';
import { toCamelCase } from '@utils/string/string.utils';
import { Interval } from 'date-fns';
import inquirer from 'inquirer';
import { compact, each, filter, flatMap, map, some } from 'lodash-es';

export const launchStream = async (context: PipelineContext) => {
  const plugins = compact(map(context, p => p.plugin));
  const watch = config.getWatch();
  switch (watch.mode) {
    case 'realtime':
      new RealtimeStream().pipe(new GapFillerStream()).pipe(new PluginsStream(plugins));
      break;
    case 'backtest':
      new BacktestStream(
        watch.scan
          ? await askForDaterange()
          : { start: toTimestamp(watch.daterange.start), end: toTimestamp(watch.daterange.end) },
      )
        .pipe(new GapFillerStream())
        .pipe(new PluginsStream(plugins));
      break;
    case 'importer':
      new ImporterStream().pipe(new GapFillerStream()).pipe(new PluginsStream(plugins));
      break;
  }
  return context;
};

const askForDaterange = async () => {
  const dateranges = inject.storage().getCandleDateranges();
  if (!dateranges) throw new NoDaterangeFoundError();
  const result = await inquirer.prompt<{ daterange: Interval<EpochTimeStamp, EpochTimeStamp> }>([
    {
      name: 'daterange',
      type: 'list',
      message: 'Please pick the daterange you are interested in testing:',
      choices: dateranges.map(b => ({
        name: `start: ${toISOString(b.daterange_start)} -> end: ${toISOString(b.daterange_end)}`,
        value: { start: b.daterange_start, end: b.daterange_end },
      })),
    },
  ]);
  return result.daterange;
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
          debug('init', `When ${emitterName} emit '${event}', ${handlerName}.${eventHandler} will be executed.`);
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
    debug('init', `${name} plugin created !`);
    return { ...pluginCtx, plugin };
  });

export const preloadMarkets = async (context: PipelineContext) => {
  const { mode } = config.getWatch();
  const isPreloadMarketNeeded =
    ['realtime', 'importer'].includes(mode) || some(context, plugin => plugin.inject?.includes('broker'));
  if (isPreloadMarketNeeded) {
    const broker = await inject.broker();
    debug('init', `Preloading Markets data for ${broker.getBrokerName()}`);
    await broker.loadMarkets();
  }
  return context;
};

export const checkPluginsDuplicateEvents = async (context: PipelineContext) => {
  const duplicateEvents = keepDuplicates(compact(flatMap(context, p => p.eventsEmitted)));
  const duplicatePlugins = map(filter(context, { eventsEmitted: duplicateEvents }), p => p.name);
  if (duplicateEvents.length) throw new PluginsEmitSameEventError(duplicatePlugins, duplicateEvents);
  return context;
};

export const checkPluginsDependencies = async (context: PipelineContext) => {
  for (const plugin of context) {
    for (const dependency of plugin.dependencies ?? []) {
      try {
        await import(dependency);
      } catch {
        throw new PluginMissingDependencyError(plugin.name, dependency);
      }
    }
  }
  return context;
};

export const validatePluginsSchema = async (context: PipelineContext) => {
  const parameters = config.getPlugins();
  return map(context, (plugin, i) => ({
    ...plugin,
    parameters: plugin.schema?.validateSync(parameters[i]),
  }));
};

export const checkPluginsModesCompatibility = async (context: PipelineContext) =>
  each(context, ({ name, modes }) => {
    const mode = config.getWatch().mode;
    if (!modes?.includes(mode)) throw new PluginUnsupportedModeError(name, mode);
  });

export const getPluginsStaticConfiguration = async (context: PipelineContext) =>
  map(context, plugin => {
    const PluginClass = pluginList[plugin.name as PluginsNames];
    const { modes, schema, dependencies, eventsEmitted, name, eventsHandlers, inject } =
      PluginClass.getStaticConfiguration();
    return { modes, schema, dependencies, eventsEmitted, name, eventsHandlers, inject };
  });
