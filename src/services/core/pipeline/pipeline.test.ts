import * as injecter from '@services/injecter/injecter';
import { describe, expect, it, vi } from 'vitest';
import { PipelineContext } from '../../../models/pipeline.types';
import * as allPlugin from '../../../plugins/index';
import * as pipelineModule from './pipeline';
import { PluginsEmitSameEventError } from './pipeline.error';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({ mode: 'realtime' })),
    getPlugins: vi.fn(() => []),
  },
}));

vi.mock('@services/injecter/injecter', () => ({
  inject: {
    exchange: vi.fn(),
  },
}));

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
}));

vi.mock('./pipeline.utils', () => ({
  streamPipelines: {
    realtime: vi.fn(),
    backtest: vi.fn(),
  },
}));

vi.mock('@plugins/index', () => ({}));

describe('Pipeline Service', () => {
  describe('launchStream', () => {
    it('should call the correct stream function based on config mode', async () => {
      const { config } = await import('@services/configuration/configuration');
      const { streamPipelines } = await import('./pipeline.utils');
      vi.mocked(config.getWatch).mockReturnValue({ mode: 'backtest' } as any);

      const context: PipelineContext = [{ name: 'TestPlugin', plugin: {} as any }];
      await pipelineModule.launchStream(context);

      expect(streamPipelines.backtest).toHaveBeenCalledWith([expect.anything()]);
    });
  });

  describe('injectServices', () => {
    it('should inject services into plugins', async () => {
      const setServiceMock = vi.fn();
      const mockService = { foo: 'bar' };

      // Setup dynamic injection mock
      (injecter.inject as any).myService = vi.fn().mockReturnValue(mockService);

      const context: PipelineContext = [
        {
          name: 'TestPlugin',
          inject: ['myService'],
          plugin: {
            setMyService: setServiceMock,
          } as any,
        },
      ];

      await pipelineModule.injectServices(context);

      expect(setServiceMock).toHaveBeenCalledWith(mockService);
    });
  });

  describe('wirePlugins', () => {
    it('should wire emitters to handlers correctly', async () => {
      const onMyEventMock = vi.fn();
      const onMock = vi.fn();

      const context: PipelineContext = [
        {
          name: 'EmitterPlugin',
          eventsEmitted: ['myEvent'],
          plugin: { on: onMock } as any,
        },
        {
          name: 'HandlerPlugin',
          eventsHandlers: ['onMyEvent'],
          plugin: { onMyEvent: onMyEventMock } as any,
        },
        {
          name: 'SilentPlugin',
          // eventsHandlers undefined
          plugin: {} as any,
        },
      ];

      await pipelineModule.wirePlugins(context);

      // Verify emitter.on was called with event name and bounded handler
      expect(onMock).toHaveBeenCalledWith('myEvent', expect.any(Function));
    });
  });

  describe('sortPluginsByWeight', () => {
    it('should sort plugins by weight in descending order', async () => {
      const context: PipelineContext = [
        { name: 'Light', weight: 1 },
        { name: 'Heavy', weight: 10 },
        { name: 'Medium', weight: 5 },
        { name: 'DefaultRef' }, // Should be treated as 0
        { name: 'DefaultRef2' }, // Another 0 to comparison
      ];

      const result = await pipelineModule.sortPluginsByWeight(context);
      const names = result.map(p => p.name);

      // Order of DefaultRef and DefaultRef2 is not strictly guaranteed relative to each other if implementation is unstable sort,
      // but they should be at the end. v8 sort is stable.
      expect(names).toEqual(['Heavy', 'Medium', 'Light', 'DefaultRef', 'DefaultRef2']);
    });
  });

  describe('createPlugins', () => {
    it('should instantiate plugins using the registry', async () => {
      class MockPlugin {
        constructor(public params: any) {}
      }
      (allPlugin as any).MockPlugin = MockPlugin;

      const context: PipelineContext = [{ name: 'MockPlugin', parameters: { foo: 'bar' } as any }];

      const result = await pipelineModule.createPlugins(context);

      expect(result[0].plugin).toBeInstanceOf(MockPlugin);
      expect((result[0].plugin as any).params).toEqual({ foo: 'bar' });
    });
  });

  describe('preloadMarkets', () => {
    it('should call loadMarkets on the injected exchange', async () => {
      const loadMarketsMock = vi.fn();
      const getExchangeNameMock = vi.fn().mockReturnValue('Binance');
      (injecter.inject as any).exchange = vi.fn(() => ({
        loadMarkets: loadMarketsMock,
        getExchangeName: getExchangeNameMock,
      }));

      await pipelineModule.preloadMarkets([] as PipelineContext);

      expect(loadMarketsMock).toHaveBeenCalled();
    });
  });

  describe('checkPluginsDuplicateEvents', () => {
    it('should throw PluginsEmitSameEventError if multiple plugins emit the same event', async () => {
      const context: PipelineContext = [
        { name: 'A', eventsEmitted: ['event1'] },
        { name: 'B', eventsEmitted: ['event1'] },
      ];

      await expect(pipelineModule.checkPluginsDuplicateEvents(context)).rejects.toThrow(PluginsEmitSameEventError);
    });

    it('should return context if no duplicates found', async () => {
      const context: PipelineContext = [
        { name: 'A', eventsEmitted: ['event1'] },
        { name: 'B', eventsEmitted: ['event2'] },
        { name: 'C' }, // eventsEmitted undefined
      ];

      const result = await pipelineModule.checkPluginsDuplicateEvents(context);
      expect(result).toBe(context);
    });
  });

  describe('checkPluginsDependencies', () => {
    it.each([['fs'], ['path']])('should pass if dependency %s exists', async dep => {
      const context: PipelineContext = [{ name: 'P', dependencies: [dep] }];
      await expect(pipelineModule.checkPluginsDependencies(context)).resolves.toBe(context);
    });

    it('should pass if no dependencies defined', async () => {
      const context: PipelineContext = [{ name: 'P' }];
      await expect(pipelineModule.checkPluginsDependencies(context)).resolves.toBe(context);
    });

    it('should throw if dependency does not exist', async () => {
      const context: PipelineContext = [{ name: 'P', dependencies: ['non-existent-dep-xyz'] }];
      await expect(pipelineModule.checkPluginsDependencies(context)).rejects.toThrow(
        /Dependency non-existent-dep-xyz not installed/,
      );
    });
  });

  describe('validatePluginsSchema', () => {
    it('should parse parameters using Zod schema', async () => {
      const { config } = await import('@services/configuration/configuration');
      const parseMock = vi.fn().mockReturnValue({ parsed: true });

      vi.mocked(config.getPlugins).mockReturnValue([{ raw: true } as any]);

      const context: PipelineContext = [
        {
          name: 'P',
          schema: { parse: parseMock } as any,
        },
      ];

      const result = await pipelineModule.validatePluginsSchema(context);

      expect(result[0].parameters).toEqual({ parsed: true });
    });
  });

  describe('checkPluginsModesCompatibility', () => {
    it.each`
      currentMode   | allowedModes                | shouldThrow
      ${'realtime'} | ${['realtime']}             | ${false}
      ${'realtime'} | ${['backtest']}             | ${true}
      ${'backtest'} | ${['realtime', 'backtest']} | ${false}
    `(
      'currentMode: $currentMode, allowed: $allowedModes => throw: $shouldThrow',
      async ({ currentMode, allowedModes, shouldThrow }) => {
        const { config } = await import('@services/configuration/configuration');
        vi.mocked(config.getWatch).mockReturnValue({ mode: currentMode } as any);

        const context: PipelineContext = [{ name: 'P', modes: allowedModes }];
        const promise = pipelineModule.checkPluginsModesCompatibility(context);

        if (shouldThrow) {
          await expect(promise).rejects.toThrow(/does not support/);
        } else {
          await expect(promise).resolves.not.toThrow();
        }
      },
    );
  });

  describe('getPluginsStaticConfiguration', () => {
    it('should retrieve static configuration from plugin classes', async () => {
      class TestPlugin {
        static getStaticConfiguration() {
          return { name: 'TestPlugin', weight: 42 };
        }
      }
      (allPlugin as any).TestPlugin = TestPlugin;

      const context: PipelineContext = [{ name: 'TestPlugin' }];
      const result = await pipelineModule.getPluginsStaticConfiguration(context);

      expect(result[0]).toMatchObject({ name: 'TestPlugin', weight: 42 });
    });
  });

  describe('gekkoPipeline', () => {
    it('should execute the full pipeline', async () => {
      // We can test this essentially by mocking getPlugins (start) and verifying launchStream (end) is called?
      // Or by spying on the chain. Given the implementation is a reduce of async functions,
      // mocking one of the intermediate steps or the final step `launchStream` is enough to prove flow.

      const { config } = await import('@services/configuration/configuration');
      const { streamPipelines } = await import('./pipeline.utils');

      // Setup minimal valid flow
      vi.mocked(config.getPlugins).mockReturnValue([]);
      vi.mocked(config.getWatch).mockReturnValue({ mode: 'realtime' } as any);

      await pipelineModule.gekkoPipeline();

      // If it reaches createPlugins -> launchStream, we are good.
      // Since context starts empty, most steps do nothing.
      expect(streamPipelines.realtime).toHaveBeenCalled();
    });
  });
});
