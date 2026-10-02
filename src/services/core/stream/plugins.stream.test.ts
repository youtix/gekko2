import { ApplicationStopError } from '@errors/applicationStop.error';
import { Candle } from '@models/candle.types';
import { Plugin } from '@plugins/plugin';
import { error, info, warning } from '@services/logger';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginsStream } from './plugins.stream';

/* -------------------------------------------------------------------------- */
/*                                    MOCKS                                   */
/* -------------------------------------------------------------------------- */

const { injectMock } = vi.hoisted(() => ({
  injectMock: {
    exchange: vi.fn(() => ({ getExchangeName: (): string => 'binance' })),
  },
}));

vi.mock('@services/injecter/injecter', () => ({ inject: injectMock }));
vi.mock('@services/logger', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

const MOCK_CANDLE = {} as Candle;

const createPluginStub = (overrides?: Partial<Plugin>) =>
  ({
    processInitStream: vi.fn(async () => undefined),
    processInputStream: vi.fn(async () => undefined),
    processCloseStream: vi.fn(async () => undefined),
    broadcastDeferredEmit: vi.fn(async () => false),
    ...overrides,
  }) as unknown as Plugin;

const callConstruct = (stream: PluginsStream) =>
  new Promise<Error | undefined>((resolve, reject) => {
    // Listen for error events to prevent unhandled error warnings
    stream.once('error', () => {});
    stream._construct(error => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });

const callFinal = (stream: PluginsStream) =>
  new Promise<Error | undefined>(resolve => {
    stream._final(error => resolve(error ?? undefined));
  });

const writeCandle = (stream: PluginsStream, candle: Candle = MOCK_CANDLE) =>
  new Promise<void>((resolve, reject) => {
    stream.write(candle, error => {
      if (error) reject(error);
      else resolve();
    });
  });

const waitForError = (stream: PluginsStream) => new Promise<Error>(resolve => stream.once('error', resolve));

const waitForFinish = (stream: PluginsStream) => new Promise<void>(resolve => stream.on('finish', resolve));

/* -------------------------------------------------------------------------- */
/*                                   TESTS                                    */
/* -------------------------------------------------------------------------- */

describe('PluginsStream', () => {
  describe('_construct', () => {
    it('calls processInitStream on each plugin', async () => {
      const plugin = createPluginStub();
      const stream = new PluginsStream([plugin]);

      await callConstruct(stream);

      expect(plugin.processInitStream).toHaveBeenCalledOnce();
    });

    it('passes Error instances to callback on init failure', async () => {
      const initError = new Error('init err');
      const plugin = createPluginStub({
        processInitStream: vi.fn(async () => {
          throw initError;
        }),
      });
      const stream = new PluginsStream([plugin]);

      await expect(callConstruct(stream)).rejects.toThrow('init err');
    });

    it('wraps non-Error thrown values in Error on init failure', async () => {
      const plugin = createPluginStub({
        processInitStream: vi.fn(async () => {
          throw 'string error';
        }),
      });
      const stream = new PluginsStream([plugin]);

      await expect(callConstruct(stream)).rejects.toThrow('Error when initializing stream plugin: string error');
    });
  });

  describe('_write', () => {
    describe('successful processing', () => {
      it('forwards candle to dummy exchange before plugins', async () => {
        const callOrder: string[] = [];
        const dummyExchange = {
          processOneMinuteBucket: vi.fn(() => callOrder.push('exchange')),
          getExchangeName: () => 'dummy-cex',
        };
        injectMock.exchange.mockReturnValue(dummyExchange);
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            callOrder.push('plugin');
          }),
        });
        const stream = new PluginsStream([plugin]);

        await writeCandle(stream);

        expect(callOrder).toEqual(['exchange', 'plugin']);
      });

      it('broadcasts deferred events after plugin processing', async () => {
        let emitCount = 0;
        const plugin = createPluginStub({
          broadcastDeferredEmit: vi.fn(async () => {
            emitCount++;
            return emitCount < 3; // Emit 2 times then stop
          }),
        });
        const stream = new PluginsStream([plugin]);

        await writeCandle(stream);

        expect(plugin.broadcastDeferredEmit).toHaveBeenCalledTimes(3);
      });
    });

    describe('error handling', () => {
      it.each`
        description                                    | throwValueError                | expectErrorMessage
        ${'finalizes all plugins before destroying'}   | ${new Error('process-failed')} | ${'process-failed'}
        ${'logs closing message on error'}             | ${new Error('dummy_err')}      | ${'dummy_err'}
        ${'converts non-Error thrown values to Error'} | ${'string error'}              | ${'string error'}
      `('$description', async ({ throwValueError, expectErrorMessage }) => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw throwValueError;
          }),
        });
        const stream = new PluginsStream([plugin]);

        stream.write(MOCK_CANDLE);
        const errorResponse = await waitForError(stream);

        // Common Expectations
        expect(plugin.processCloseStream).toHaveBeenCalledOnce();

        expect(errorResponse!.message).toBe(expectErrorMessage);

        if (expectErrorMessage === 'dummy_err') {
          expect(error).toHaveBeenCalledWith('stream', 'Gekko is closing the application due to an error!');
        }
      });

      describe('on ApplicationStopError', () => {
        const stopError = new ApplicationStopError('stop error application');
        let plugin: Plugin;
        let pipelineRejection: unknown;

        beforeEach(async () => {
          plugin = createPluginStub({
            processInputStream: vi.fn(async () => {
              throw stopError;
            }),
          });
          pipelineRejection = await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream([plugin])).catch((reason: unknown) => reason);
        });

        it('rejects the pipeline with the ApplicationStopError itself, not a premature close', () => {
          expect(pipelineRejection).toBe(stopError);
        });

        it('finalizes all plugins', () => {
          expect(plugin.processCloseStream).toHaveBeenCalledOnce();
        });

        it('logs the stop reason as a warning', () => {
          expect(warning).toHaveBeenCalledWith('stream', 'Application stopped gracefully: [CORE] stop error application');
        });

        it('logs the stop reason before finalizing the plugins', () => {
          const [logCallOrder] = vi.mocked(warning).mock.invocationCallOrder;
          const [finalizeCallOrder] = vi.mocked(plugin.processCloseStream).mock.invocationCallOrder;
          expect(logCallOrder).toBeLessThan(finalizeCallOrder);
        });
      });

      it('does not finalize twice when _final called after error', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw new Error('fail');
          }),
        });
        const stream = new PluginsStream([plugin]);
        stream.write(MOCK_CANDLE);
        await waitForError(stream);

        await callFinal(stream);

        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('finalizes all plugins even when some throw', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin1 = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw new Error('fail');
          }),
          processCloseStream: vi.fn(async () => {
            throw new Error('finalize1 failed');
          }),
        });
        const plugin2 = createPluginStub();
        const stream = new PluginsStream([plugin1, plugin2]);
        stream.write(MOCK_CANDLE);

        await waitForError(stream);

        expect(plugin2.processCloseStream).toHaveBeenCalledOnce();
      });

      it('logs warning when finalization fails', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw new Error('fail');
          }),
          processCloseStream: vi.fn(async () => {
            throw new Error('finalize failed');
          }),
        });
        const stream = new PluginsStream([plugin]);
        stream.write(MOCK_CANDLE);

        await waitForError(stream);

        expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: finalize failed');
      });
    });
  });

  describe('_final', () => {
    it('calls processCloseStream on each plugin', async () => {
      const plugin = createPluginStub();
      const stream = new PluginsStream([plugin]);
      stream.end();

      await waitForFinish(stream);

      expect(plugin.processCloseStream).toHaveBeenCalledOnce();
    });

    it('logs closing message on normal shutdown', async () => {
      const stream = new PluginsStream([createPluginStub()]);
      stream.end();

      await waitForFinish(stream);

      expect(info).toHaveBeenCalledWith('stream', 'Gekko is closing the application !');
    });

    it('logs warning when plugin finalization throws', async () => {
      const plugin = createPluginStub({
        processCloseStream: vi.fn(async () => {
          throw new Error('finalize err');
        }),
      });
      const stream = new PluginsStream([plugin]);
      stream.end();

      await waitForFinish(stream);

      expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: finalize err');
    });

    it('converts non-Error rejection to Error during finalization', async () => {
      const plugin = createPluginStub({
        processCloseStream: vi.fn(async () => {
          throw 'string rejection';
        }),
      });
      const stream = new PluginsStream([plugin]);
      stream.end();

      await waitForFinish(stream);

      expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: string rejection');
    });

    it('passes Error to callback when _final throws', async () => {
      const plugin = createPluginStub();
      const stream = new PluginsStream([plugin]);

      Object.defineProperty(stream, 'finalizeAllPlugins', {
        value: async () => {
          throw new Error('final error');
        },
      });

      const result = await callFinal(stream);

      expect(result?.message).toBe('final error');
    });

    it('converts non-Error exception to Error in _final', async () => {
      const plugin = createPluginStub();
      const stream = new PluginsStream([plugin]);

      Object.defineProperty(stream, 'finalizeAllPlugins', {
        value: async () => {
          throw 'string exception';
        },
      });

      const result = await callFinal(stream);

      expect(result?.message).toBe('string exception');
    });

    it('skips finalization when already finalized', async () => {
      const plugin = createPluginStub();
      const stream = new PluginsStream([plugin]);

      // Pre-set the finalized flag to true
      (stream as unknown as { finalized: boolean }).finalized = true;

      // Call finalizeAllPlugins directly to test the early return at line 76
      await (stream as unknown as { finalizeAllPlugins: () => Promise<void> }).finalizeAllPlugins();

      expect(plugin.processCloseStream).not.toHaveBeenCalled();
    });
  });

  describe('_destroy', () => {
    describe('when a stream upstream fails mid-stream', () => {
      const sourceError = new Error('download failed');
      let plugins: Plugin[];
      let pipelineRejection: unknown;

      beforeEach(async () => {
        let onBucketProcessed = () => {};
        const bucketProcessed = new Promise<void>(resolve => (onBucketProcessed = resolve));
        plugins = [
          createPluginStub({ processInputStream: vi.fn(async () => onBucketProcessed()) }),
          createPluginStub({
            processCloseStream: vi.fn(async () => {
              throw new Error('finalize failed');
            }),
          }),
        ];
        async function* failingSource() {
          yield MOCK_CANDLE;
          await bucketProcessed; // Fails once the plugins have processed a bucket, like a download that breaks off
          throw sourceError;
        }

        pipelineRejection = await pipeline(Readable.from(failingSource()), new PluginsStream(plugins)).catch((reason: unknown) => reason);
      });

      it('rejects the pipeline with the error of the source, not with the finalization failure', () => {
        expect(pipelineRejection).toBe(sourceError);
      });

      it.each`
        index | plugin
        ${0}  | ${'first'}
        ${1}  | ${'second'}
      `('finalizes the $plugin plugin exactly once', ({ index }) => {
        expect(plugins[index].processCloseStream).toHaveBeenCalledOnce();
      });
    });

    describe('when _construct fails on the second of three plugins', () => {
      const initError = new Error('init failed');
      let plugins: Plugin[];
      let pipelineRejection: unknown;

      beforeEach(async () => {
        plugins = [
          createPluginStub(),
          createPluginStub({
            processInitStream: vi.fn(async () => {
              throw initError;
            }),
          }),
          createPluginStub(),
        ];

        pipelineRejection = await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream(plugins)).catch((reason: unknown) => reason);
      });

      it('rejects the pipeline with the init error', () => {
        expect(pipelineRejection).toBe(initError);
      });

      it.each`
        index | outcome                | plugin                 | calls
        ${0}  | ${'finalizes'}         | ${'initialized'}       | ${1}
        ${1}  | ${'does not finalize'} | ${'whose init failed'} | ${0}
        ${2}  | ${'does not finalize'} | ${'never initialized'} | ${0}
      `('$outcome the plugin $plugin', ({ index, calls }) => {
        expect(plugins[index].processCloseStream).toHaveBeenCalledTimes(calls);
      });
    });

    it('does not finalize the plugins again after a normal end', async () => {
      const plugin = createPluginStub();

      await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream([plugin]));

      expect(plugin.processCloseStream).toHaveBeenCalledOnce();
    });

    describe('when finalizing the plugins throws', () => {
      const destroyError = new Error('download failed');

      const destroyWhileFinalizationThrows = (thrown: unknown) => {
        const stream = new PluginsStream([createPluginStub()]);
        Object.defineProperty(stream, 'finalizeAllPlugins', {
          value: async () => {
            throw thrown;
          },
        });
        stream.destroy(destroyError);
        return waitForError(stream);
      };

      it('still reports the error the stream was destroyed with', async () => {
        expect(await destroyWhileFinalizationThrows(new Error('finalize failed'))).toBe(destroyError);
      });

      it.each`
        kind               | thrown
        ${'an Error'}      | ${new Error('finalize failed')}
        ${'another value'} | ${'finalize failed'}
      `('logs the failure as a warning when finalization throws $kind', async ({ thrown }) => {
        await destroyWhileFinalizationThrows(thrown);

        expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: finalize failed');
      });
    });
  });
});
