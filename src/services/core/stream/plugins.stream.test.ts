import { ApplicationStopError } from '@errors/applicationStop.error';
import { CandleBucket } from '@models/event.types';
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

const BUCKET: CandleBucket = new Map();

const createPluginStub = (overrides?: Partial<Record<keyof Plugin, unknown>>) =>
  ({
    processInitStream: vi.fn(async () => undefined),
    processInputStream: vi.fn(async () => undefined),
    processCloseStream: vi.fn(async () => undefined),
    broadcastDeferredEmit: vi.fn(async () => false),
    ...overrides,
  }) as unknown as Plugin;

/** A promise settled from outside, to hold a plugin or a source at a given step. */
const createGate = () => {
  let open = () => {};
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
};

/** Runs the plugins through the public API, as pipeline.utils does, and returns what the pipeline rejected with, if anything. */
const runPipeline = (source: Iterable<CandleBucket> | AsyncIterable<CandleBucket>, plugins: Plugin[]) =>
  pipeline(Readable.from(source), new PluginsStream(plugins)).then(
    () => undefined,
    (reason: unknown) => reason,
  );

const throwing = (thrown: unknown) =>
  vi.fn(async () => {
    throw thrown;
  });

/* -------------------------------------------------------------------------- */
/*                                   TESTS                                    */
/* -------------------------------------------------------------------------- */

describe('PluginsStream', () => {
  describe('_construct', () => {
    it('initializes each plugin once', async () => {
      const plugin = createPluginStub();

      await runPipeline([], [plugin]);

      expect(plugin.processInitStream).toHaveBeenCalledOnce();
    });

    it.each`
      thrown                   | message
      ${new Error('init err')} | ${'init err'}
      ${'string error'}        | ${'Error when initializing stream plugin: string error'}
    `('rejects the pipeline with $message when a plugin init throws $thrown', async ({ thrown, message }) => {
      const plugin = createPluginStub({ processInitStream: throwing(thrown) });

      expect(await runPipeline([BUCKET], [plugin])).toEqual(new Error(message));
    });

    describe('when the stream is destroyed while a plugin initializes', () => {
      const destroyError = new Error('download failed');
      let plugins: Plugin[];
      let reported: unknown;

      beforeEach(async () => {
        const initGate = createGate();
        plugins = [createPluginStub({ processInitStream: vi.fn(() => initGate.promise) }), createPluginStub()];
        const stream = new PluginsStream(plugins);
        const errored = new Promise(resolve => stream.once('error', resolve));
        await vi.waitFor(() => expect(plugins[0].processInitStream).toHaveBeenCalled());

        stream.destroy(destroyError);
        initGate.open();
        reported = await errored;
      });

      it('reports the error it was destroyed with', () => {
        expect(reported).toBe(destroyError);
      });

      it('finalizes the plugin whose init was in progress, once it is done', () => {
        expect(plugins[0].processCloseStream).toHaveBeenCalledOnce();
      });

      it('does not initialize the plugins left', () => {
        expect(plugins[1].processInitStream).not.toHaveBeenCalled();
      });
    });
  });

  describe('_write', () => {
    describe('successful processing', () => {
      it('forwards the bucket to the dummy exchange before the plugins', async () => {
        const callOrder: string[] = [];
        const dummyExchange = { processOneMinuteBucket: vi.fn(() => callOrder.push('exchange')), getExchangeName: () => 'dummy-cex' };
        injectMock.exchange.mockReturnValue(dummyExchange);
        const plugin = createPluginStub({ processInputStream: vi.fn(async () => callOrder.push('plugin')) });

        await runPipeline([BUCKET], [plugin]);

        expect(callOrder).toEqual(['exchange', 'plugin']);
      });

      it('broadcasts the deferred events of each plugin until its queue is empty, in config order', async () => {
        const callOrder: string[] = [];
        const queues = [2, 1];
        const plugins = queues.map((_, index) =>
          createPluginStub({
            broadcastDeferredEmit: vi.fn(async () => {
              callOrder.push(`plugin ${index}`);
              return queues[index]-- > 0;
            }),
          }),
        );

        await runPipeline([BUCKET], plugins);

        expect(callOrder).toEqual(['plugin 0', 'plugin 0', 'plugin 0', 'plugin 1', 'plugin 1']);
      });

      it('finalizes the plugins at the end of the stream', async () => {
        const plugin = createPluginStub();

        await runPipeline([BUCKET], [plugin]);

        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('logs the closing message at the end of the stream', async () => {
        await runPipeline([BUCKET], [createPluginStub()]);

        expect(info).toHaveBeenCalledWith('stream', 'Gekko is closing the application !');
      });
    });

    describe('when a plugin fails on a bucket', () => {
      it.each`
        thrown                         | message
        ${new Error('process-failed')} | ${'process-failed'}
        ${'string error'}              | ${'string error'}
      `('rejects the pipeline with $message when a plugin throws $thrown', async ({ thrown, message }) => {
        const plugin = createPluginStub({ processInputStream: throwing(thrown) });

        expect(await runPipeline([BUCKET], [plugin])).toEqual(new Error(message));
      });

      it('finalizes the plugins', async () => {
        const plugin = createPluginStub({ processInputStream: throwing(new Error('fail')) });

        await runPipeline([BUCKET], [plugin]);

        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('logs the error message', async () => {
        const plugin = createPluginStub({ processInputStream: throwing(new Error('dummy_err')) });

        await runPipeline([BUCKET], [plugin]);

        expect(error).toHaveBeenCalledWith('stream', 'Gekko is closing the application due to an error: dummy_err');
      });

      it('does not process the buckets that follow', async () => {
        const plugin = createPluginStub({ processInputStream: throwing(new Error('fail')) });

        await runPipeline([BUCKET, BUCKET, BUCKET], [plugin]);

        expect(plugin.processInputStream).toHaveBeenCalledOnce();
      });

      it('finalizes all the plugins even when some finalizations throw', async () => {
        const plugins = [
          createPluginStub({
            processInputStream: throwing(new Error('fail')),
            processCloseStream: throwing(new Error('finalize1 failed')),
          }),
          createPluginStub(),
        ];

        await runPipeline([BUCKET], plugins);

        expect(plugins[1].processCloseStream).toHaveBeenCalledOnce();
      });

      describe('when the finalization itself throws', () => {
        const bucketError = new Error('fail');
        let rejection: unknown;

        beforeEach(async () => {
          vi.mocked(warning).mockImplementationOnce(() => {
            throw new Error('log down');
          });
          const plugin = createPluginStub({
            processInputStream: throwing(bucketError),
            processCloseStream: throwing(new Error('finalize failed')),
          });

          rejection = await runPipeline([BUCKET], [plugin]);
        });

        it('still rejects the pipeline with the error of the bucket', () => {
          expect(rejection).toBe(bucketError);
        });

        it('logs the failure as a warning', () => {
          expect(warning).toHaveBeenLastCalledWith('stream', 'Finalization errors: log down');
        });
      });

      it.each`
        kind               | thrown
        ${'an Error'}      | ${new Error('finalize failed')}
        ${'another value'} | ${'finalize failed'}
      `('logs a finalization that throws $kind as a warning', async ({ thrown }) => {
        const plugin = createPluginStub({ processInputStream: throwing(new Error('fail')), processCloseStream: throwing(thrown) });

        await runPipeline([BUCKET], [plugin]);

        expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: finalize failed');
      });
    });

    describe('when several plugins fail on the same bucket', () => {
      const firstError = new Error('first failed');
      let callOrder: string[];
      let plugins: Plugin[];
      let rejection: unknown;

      beforeEach(async () => {
        callOrder = [];
        const slow = vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          callOrder.push('slow plugin done');
          throw 'third failed';
        });
        plugins = [
          createPluginStub({ processInputStream: throwing(firstError), processCloseStream: vi.fn(async () => callOrder.push('finalize')) }),
          createPluginStub({ processInputStream: throwing(new Error('second failed')) }),
          createPluginStub({ processInputStream: slow }),
        ];

        rejection = await runPipeline([BUCKET], plugins);
      });

      it('rejects the pipeline with the error of the first plugin in config order', () => {
        expect(rejection).toBe(firstError);
      });

      it('finalizes the plugins only once every plugin is done with the bucket', () => {
        expect(callOrder).toEqual(['slow plugin done', 'finalize']);
      });

      it.each`
        message
        ${'Another plugin failed on the same bucket: second failed'}
        ${'Another plugin failed on the same bucket: third failed'}
      `('logs the other failure: $message', ({ message }) => {
        expect(error).toHaveBeenCalledWith('stream', message);
      });
    });

    describe.each`
      source                                 | overrides
      ${'processInputStream'}                | ${'processInputStream'}
      ${'broadcastDeferredEmit (a handler)'} | ${'broadcastDeferredEmit'}
    `('on an ApplicationStopError thrown by $source', ({ overrides }) => {
      const stopError = new ApplicationStopError('stop error application');
      let plugin: Plugin;
      let rejection: unknown;

      beforeEach(async () => {
        plugin = createPluginStub({ [overrides]: throwing(stopError) });
        rejection = await runPipeline([BUCKET], [plugin]);
      });

      it('rejects the pipeline with the ApplicationStopError itself, not a premature close', () => {
        expect(rejection).toBe(stopError);
      });

      it('finalizes all plugins', () => {
        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('logs a short warning, leaving the reason to main()', () => {
        expect(warning).toHaveBeenCalledWith('stream', 'Application stop requested, finalizing the plugins');
      });

      it('does not log the reason itself', () => {
        expect([...vi.mocked(warning).mock.calls, ...vi.mocked(error).mock.calls].flat().join('\n')).not.toContain(
          'stop error application',
        );
      });

      it('logs the warning before finalizing the plugins', () => {
        const [logCallOrder] = vi.mocked(warning).mock.invocationCallOrder;
        const [finalizeCallOrder] = vi.mocked(plugin.processCloseStream).mock.invocationCallOrder;
        expect(logCallOrder).toBeLessThan(finalizeCallOrder);
      });
    });
  });

  describe('_final', () => {
    it.each`
      kind               | thrown
      ${'an Error'}      | ${new Error('finalize err')}
      ${'another value'} | ${'finalize err'}
    `('logs a plugin finalization that throws $kind as a warning', async ({ thrown }) => {
      const plugin = createPluginStub({ processCloseStream: throwing(thrown) });

      await runPipeline([BUCKET], [plugin]);

      expect(warning).toHaveBeenCalledWith('stream', 'Finalization errors: finalize err');
    });

    it.each`
      kind               | thrown                   | message
      ${'an Error'}      | ${new Error('log down')} | ${'log down'}
      ${'another value'} | ${'log down'}            | ${'log down'}
    `('rejects the pipeline when the finalization itself throws $kind', async ({ thrown, message }) => {
      vi.mocked(warning).mockImplementationOnce(() => {
        throw thrown;
      });
      const plugin = createPluginStub({ processCloseStream: throwing(new Error('finalize err')) });

      expect(await runPipeline([BUCKET], [plugin])).toEqual(new Error(message));
    });
  });

  describe('_destroy', () => {
    describe('when a stream upstream fails between two buckets', () => {
      const sourceError = new Error('download failed');
      let plugins: Plugin[];
      let rejection: unknown;

      beforeEach(async () => {
        const bucketProcessed = createGate();
        plugins = [
          createPluginStub({ processInputStream: vi.fn(async () => bucketProcessed.open()) }),
          createPluginStub({ processCloseStream: throwing(new Error('finalize failed')) }),
        ];
        async function* failingSource() {
          yield BUCKET;
          await bucketProcessed.promise; // Fails once the plugins have processed a bucket, like a download that breaks off
          throw sourceError;
        }

        rejection = await runPipeline(failingSource(), plugins);
      });

      it('rejects the pipeline with the error of the source, not with the finalization failure', () => {
        expect(rejection).toBe(sourceError);
      });

      it.each`
        index | plugin
        ${0}  | ${'first'}
        ${1}  | ${'second'}
      `('finalizes the $plugin plugin exactly once', ({ index }) => {
        expect(plugins[index].processCloseStream).toHaveBeenCalledOnce();
      });
    });

    describe('when a stream upstream fails while a bucket is processed', () => {
      const sourceError = new Error('download failed');
      let callOrder: string[];
      let rejection: unknown;

      beforeEach(async () => {
        callOrder = [];
        const bucketStarted = createGate();
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            bucketStarted.open();
            await new Promise(resolve => setTimeout(resolve, 10));
            callOrder.push('bucket processed');
          }),
          processCloseStream: vi.fn(async () => callOrder.push('finalize')),
        });
        async function* failingSource() {
          yield BUCKET;
          await bucketStarted.promise;
          throw sourceError;
        }

        rejection = await runPipeline(failingSource(), [plugin]);
      });

      it('rejects the pipeline with the error of the source', () => {
        expect(rejection).toBe(sourceError);
      });

      it('finalizes the plugins once the bucket is processed', () => {
        expect(callOrder).toEqual(['bucket processed', 'finalize']);
      });
    });

    describe('when a stream upstream fails while the plugins are finalized after an ApplicationStopError', () => {
      const stopError = new ApplicationStopError('circuit breaker');
      const sourceError = new Error('download failed');
      let plugins: Plugin[];
      let rejection: unknown;
      let reported: unknown;
      let failure: unknown;

      beforeEach(async () => {
        const finalizationStarted = createGate();
        const finalizationGate = createGate();
        plugins = [
          createPluginStub({ processInputStream: throwing(stopError) }),
          createPluginStub({
            processCloseStream: vi.fn(async () => {
              finalizationStarted.open();
              await finalizationGate.promise;
            }),
          }),
        ];
        async function* failingSource() {
          yield BUCKET;
          await finalizationStarted.promise;
          setTimeout(finalizationGate.open, 10);
          throw sourceError;
        }
        const stream = new PluginsStream(plugins);
        stream.on('error', reason => (reported = reason));

        rejection = await pipeline(Readable.from(failingSource()), stream).catch((reason: unknown) => reason);
        failure = stream.failure;
      });

      // pipeline() keeps the first error of the chain: the caller has to read the stream's failure to see the stop
      it('rejects the pipeline with the error of the source, which came first', () => {
        expect(rejection).toBe(sourceError);
      });

      it('emits the ApplicationStopError', () => {
        expect(reported).toBe(stopError);
      });

      it('exposes the ApplicationStopError as its failure', () => {
        expect(failure).toBe(stopError);
      });

      it.each`
        index
        ${0}
        ${1}
      `('finalizes the plugin $index exactly once', ({ index }) => {
        expect(plugins[index].processCloseStream).toHaveBeenCalledOnce();
      });
    });

    describe('when _construct fails on the second of three plugins', () => {
      const initError = new Error('init failed');
      let plugins: Plugin[];
      let rejection: unknown;

      beforeEach(async () => {
        plugins = [createPluginStub(), createPluginStub({ processInitStream: throwing(initError) }), createPluginStub()];

        rejection = await runPipeline([BUCKET], plugins);
      });

      it('rejects the pipeline with the init error', () => {
        expect(rejection).toBe(initError);
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

      await runPipeline([BUCKET], [plugin]);

      expect(plugin.processCloseStream).toHaveBeenCalledOnce();
    });

    describe('when the finalization itself throws', () => {
      const sourceError = new Error('download failed');

      const failWhileFinalizationThrows = (thrown: unknown) => {
        vi.mocked(warning).mockImplementationOnce(() => {
          throw thrown;
        });
        const bucketProcessed = createGate();
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => bucketProcessed.open()),
          processCloseStream: throwing(new Error('finalize failed')),
        });
        async function* failingSource() {
          yield BUCKET;
          await bucketProcessed.promise;
          throw sourceError;
        }
        return runPipeline(failingSource(), [plugin]);
      };

      it('still rejects the pipeline with the error of the source', async () => {
        expect(await failWhileFinalizationThrows(new Error('log down'))).toBe(sourceError);
      });

      it.each`
        kind               | thrown
        ${'an Error'}      | ${new Error('log down')}
        ${'another value'} | ${'log down'}
      `('logs the failure as a warning when the finalization throws $kind', async ({ thrown }) => {
        await failWhileFinalizationThrows(thrown);

        expect(warning).toHaveBeenLastCalledWith('stream', 'Finalization errors: log down');
      });
    });
  });
});
