import { describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../../../models/pipeline.types';
import * as allPlugin from '../../../plugins/index';
import {
  checkPluginsDependencies,
  checkPluginsDuplicateEvents,
  checkPluginsModesCompatibility,
  createPlugins,
  getPluginsStaticConfiguration,
} from './pipeline';

vi.mock('@services/configuration/configuration', () => ({
  config: { getWatch: vi.fn(() => ({ mode: 'realtime' })) },
}));
vi.mock('@services/injecter/injecter', () => ({ inject: {} }));
vi.mock('@plugins/index');
describe('Pipeline Steps', () => {
  describe('checkPluginsDuplicateEvents', () => {
    it('returns context when no duplicate events are present', async () => {
      const context: PipelineContext = [
        { name: 'one', eventsEmitted: ['a'] },
        { name: 'two', eventsEmitted: ['b'] },
      ];

      const result = await checkPluginsDuplicateEvents(context);
      expect(result).toBe(context);
    });

    it('throws PluginsEmitSameEventError when duplicates exist', async () => {
      const context: PipelineContext = [
        { name: 'first', eventsEmitted: ['ev1', 'ev2'] },
        { name: 'second', eventsEmitted: ['ev2'] },
        { name: 'third', eventsEmitted: ['ev3', 'ev1'] },
      ];

      await expect(checkPluginsDuplicateEvents(context)).rejects.toThrow('Multiple plugins');
    });
  });
  describe('createPlugins', () => {
    it('should instantiates plugins with parameters', async () => {
      class MyPlugin {
        parameters: unknown;
        constructor(p: unknown) {
          this.parameters = p;
        }
      }

      (allPlugin as any)['MyPlugin'] = MyPlugin;

      const context: PipelineContext = [{ name: 'MyPlugin', parameters: { name: 'bar' } }];

      const result = await createPlugins(context);
      expect(result[0].plugin).toBeInstanceOf(MyPlugin);
      expect((result[0].plugin as any).parameters).toEqual({ name: 'bar' });
    });
  });
  describe('getPluginsStaticConfiguration', () => {
    it('should return plugin metadata', async () => {
      class Plug {
        static getStaticConfiguration() {
          return {
            modes: ['realtime'],
            schema: undefined,
            dependencies: [],
            eventsEmitted: [],
            name: 'Plug',
            eventsHandlers: [],
            inject: [],
          };
        }
      }

      (allPlugin as any)['Plug'] = Plug;
      const res = await getPluginsStaticConfiguration([{ name: 'Plug' }]);
      expect(res[0]).toEqual({
        modes: ['realtime'],
        schema: undefined,
        dependencies: [],
        eventsEmitted: [],
        name: 'Plug',
        eventsHandlers: [],
        inject: [],
      });
    });
  });
  describe('checkPluginsDependencies', () => {
    it('should validate module presence', async () => {
      const ctx: PipelineContext = [{ name: 'DepPlugin', dependencies: ['fs'] }];
      await expect(checkPluginsDependencies(ctx)).resolves.toBe(ctx);
    });
    it('should throw on missing module', async () => {
      const ctx: PipelineContext = [{ name: 'DepPlugin', dependencies: ['nope-nope'] }];
      await expect(checkPluginsDependencies(ctx)).rejects.toThrow('Dependency nope-nope');
    });
  });
  describe('checkPluginsModesCompatibility', () => {
    it('should detect incompatible mode', async () => {
      await expect(checkPluginsModesCompatibility([{ name: 'p', modes: ['backtest'] }])).rejects.toThrow('realtime');
    });

    it('should pass when mode allowed', async () => {
      const ctx: PipelineContext = [{ name: 'p', modes: ['realtime', 'backtest'] }];
      await expect(checkPluginsModesCompatibility(ctx)).resolves.toBe(ctx);
    });
  });
});
