import { describe, expect, it, vi } from 'vitest';
import { PluginMissingDependencyError } from '../../errors/plugin/pluginMissingDependency.error';
import { PluginsEmitSameEventError } from '../../errors/plugin/pluginsEmitSameEvent.error';
import { PluginUnsupportedModeError } from '../../errors/plugin/pluginUnsupportedMode.error';
import * as pluginList from '../../plugins/index';
import { logger } from '../../services/logger';
import { checkDuplicateEvents, validatePlugins, wirePlugins } from './pipeline.utils';

vi.mock('../../plugins/index', () => ({
  pluginA: vi.fn(() => ({ on: vi.fn() })),
}));
vi.mock('../../services/logger');
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getWatch = vi.fn(() => ({ mode: 'realtime' }));
  return { config: new Configuration() };
});
vi.mock('bun:sqlite');

const mockPlugins = [
  {
    name: 'pluginA',
    eventsEmitted: ['eventX'],
    eventsHandlers: ['onEventY'],
    plugin: { on: vi.fn() },
  },
  {
    name: 'pluginB',
    eventsEmitted: [],
    eventsHandlers: ['onEventX'],
    plugin: { onEventX: vi.fn() },
  },
];

describe('launchStream', () => {
  it.todo('should initialize a RealtimeStream when mode is realtime');
  it.todo('should initialize an ImporterStream when mode is importer');
  it.todo('should implement backtest functionality when mode is backtest');
  it.todo('should return the pipeline unchanged');
});

describe('prepareMarket', () => {
  it.todo('should implement backtest with BDD reader');
  it.todo('should implement daterange selection for backtest');
  it.todo('should return the pipeline unchanged');
});

describe('wirePlugins', () => {
  it('should correctly wire plugins to event emitters', () => {
    const plugins = wirePlugins(mockPlugins);
    expect(plugins).toBe(mockPlugins); // Ensure it returns the same array
  });

  it('should log the correct wiring messages', () => {
    wirePlugins(mockPlugins);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('When pluginA emit "eventX", pluginB.onEventX will be executed.'),
    );
  });
});

describe('checkDuplicateEvents', () => {
  it('should throw an error if duplicate events are found', () => {
    const duplicatePlugins = [
      { name: 'pluginA', eventsEmitted: ['eventX', 'eventY'] },
      { name: 'pluginB', eventsEmitted: ['eventX'] },
    ];

    expect(() => checkDuplicateEvents(duplicatePlugins)).toThrow(PluginsEmitSameEventError);
  });

  it('should return plugins if no duplicate events are found', () => {
    expect(() => checkDuplicateEvents(mockPlugins)).not.toThrow();
  });
});

describe('validatePlugins', () => {
  it('should validate plugins based on configuration and dependencies', async () => {
    pluginList['pluginA'] = vi.fn();
    pluginList['pluginA'].getStaticConfiguration = vi.fn(() => ({
      modes: ['realtime'],
      schema: { validateSync: vi.fn(() => mockPlugins[0]) },
      dependencies: [],
      eventsEmitted: ['eventX'],
      name: 'pluginA',
      eventsHandlers: ['onEventX'],
    }));
    pluginList['pluginB'] = vi.fn();
    pluginList['pluginB'].getStaticConfiguration = vi.fn(() => ({
      modes: ['realtime'],
      schema: { validateSync: vi.fn(() => mockPlugins[0]) },
      dependencies: [],
      eventsEmitted: ['eventY'],
      name: 'pluginB',
      eventsHandlers: ['onEventY'],
    }));

    const validatedPlugins = validatePlugins(mockPlugins);
    expect(validatedPlugins).toHaveLength(2);
  });

  it('should throw an error if a plugin is not supported in the current mode', () => {
    pluginList['pluginA'] = vi.fn();
    pluginList['pluginA'].getStaticConfiguration = vi.fn(() => ({
      modes: ['unsupportedMode'],
    }));

    expect(() => validatePlugins(mockPlugins)).toThrow(PluginUnsupportedModeError);
  });

  it.skip('should throw an error if a required dependency is missing', async () => {
    vi.mock('moduleName', () => {
      throw new Error('Cannot find module');
    });

    pluginList['pluginA'] = vi.fn();
    pluginList['pluginA'].getStaticConfiguration = vi.fn(() => ({
      dependencies: ['missingDependency'],
    }));

    await expect(() => validatePlugins(mockPlugins)).rejects.toThrow(PluginMissingDependencyError);
  });
});
