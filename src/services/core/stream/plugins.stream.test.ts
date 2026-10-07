import { ApplicationStopError } from '@errors/applicationStop.error';
import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { Plugin } from '@plugins/plugin';
import { error, info, warning } from '@services/logger';
import { SequentialEventEmitter } from '@utils/event/sequentialEventEmitter';
import { noop } from 'lodash-es';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
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

/** A stub plugin on a real SequentialEventEmitter named `name`: what it queues is broadcast, or counted, as a plugin's is */
const createEmittingPluginStub = (name: string) =>
  Object.assign(new SequentialEventEmitter(name), {
    processInitStream: vi.fn(async () => undefined),
    processInputStream: vi.fn(async () => undefined),
    processCloseStream: vi.fn(async () => undefined),
  }) as unknown as Plugin;

const createPluginStub = (overrides?: Partial<Plugin>) =>
  ({
    emitterName: 'Stub',
    processInitStream: vi.fn(async () => undefined),
    processInputStream: vi.fn(async () => undefined),
    processCloseStream: vi.fn(async () => undefined),
    broadcastDeferredEmit: vi.fn(async () => false),
    countUndeliveredPayloads: vi.fn(() => new Map()),
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

/**
 * Work a stub plugin holds until the test releases it, as one awaiting the exchange would: `run` is the stub's method, `started`
 * settles once the plugin has begun it, and `finished` is called as it ends. It resolves to false, as broadcastDeferredEmit does
 * once nothing more is queued.
 */
const createHeldWork = () => {
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const finished = vi.fn();
  const run = vi.fn(async () => {
    started.resolve();
    await released.promise;
    finished();
    return false;
  });
  return { run, started: started.promise, release: () => released.resolve(), finished };
};

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
      /** Writes a bucket that the plugin of the stream fails on, throwing `thrown`: gives the plugin and the error the stream emits */
      const writeFailingBucket = async (thrown: unknown) => {
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw thrown;
          }),
        });
        const stream = new PluginsStream([plugin]);
        stream.write(MOCK_CANDLE);
        return { plugin, streamError: await waitForError(stream) };
      };

      it('finalizes all plugins before destroying', async () => {
        const { plugin } = await writeFailingBucket(new Error('process-failed'));
        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it.each`
        kind               | thrown                         | message
        ${'an Error'}      | ${new Error('process-failed')} | ${'process-failed'}
        ${'another value'} | ${'string error'}              | ${'string error'}
      `('destroys the stream with $kind thrown, as an Error', async ({ thrown, message }) => {
        const { streamError } = await writeFailingBucket(thrown);
        expect(streamError.message).toBe(message);
      });

      it.each`
        kind               | thrown                                    | reason
        ${'a GekkoError'}  | ${new GekkoError('trader', 'No balance')} | ${'[TRADER] No balance'}
        ${'an Error'}      | ${new TypeError('fetch failed')}          | ${'TypeError: fetch failed'}
        ${'a string'}      | ${'string error'}                         | ${'string error'}
        ${'another value'} | ${{ code: 42 }}                           | ${'{ code: 42 }'}
      `('logs why the application closes when a plugin throws $kind', async ({ thrown, reason }) => {
        await writeFailingBucket(thrown);
        expect(error).toHaveBeenCalledWith('stream', `Gekko is closing the application due to an error: ${reason}`);
      });

      it('logs why the application closes before finalizing the plugins, for the last flush of Supervision to send it', async () => {
        const { plugin } = await writeFailingBucket(new Error('process-failed'));
        const [logCallOrder] = vi.mocked(error).mock.invocationCallOrder;
        const [finalizeCallOrder] = vi.mocked(plugin.processCloseStream).mock.invocationCallOrder;
        expect(logCallOrder).toBeLessThan(finalizeCallOrder);
      });

      it('logs why the application closes once, not again when the stream is destroyed', async () => {
        await writeFailingBucket(new Error('process-failed'));
        expect(error).toHaveBeenCalledOnce();
      });

      describe('on ApplicationStopError', () => {
        const stopError = new ApplicationStopError('stop error application');
        let plugin: Plugin;
        let stream: PluginsStream;
        let pipelineRejection: unknown;

        beforeEach(async () => {
          plugin = createPluginStub({
            processInputStream: vi.fn(async () => {
              throw stopError;
            }),
          });
          stream = new PluginsStream([plugin]);
          pipelineRejection = await pipeline(Readable.from([MOCK_CANDLE]), stream).catch((reason: unknown) => reason);
        });

        it('rejects the pipeline with the ApplicationStopError itself, not a premature close', () => {
          expect(pipelineRejection).toBe(stopError);
        });

        // The failed write destroys the stream itself, and _destroy waits for that write to settle: neither may wait for the other
        it('closes the stream it destroys from the failed write', () => {
          expect(stream.closed).toBe(true);
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

      describe('when a handler stops the application during the flush, with deferred events still queued', () => {
        const STOP_LOG = 'Application stopped gracefully: [CORE] Max consecutive order errors reached (1)';
        const DROPPED_EVENTS_LOG =
          'Deferred events dropped as the application closes, the final reports may miss them: ' +
          'Trader (orderCompleted: 1, portfolioChange: 2), RoundTripAnalyzer (roundtripCompleted: 1)';
        let plugins: Plugin[];
        let onOrderCompleted: Mock;

        beforeEach(async () => {
          const advisor = createEmittingPluginStub('TradingAdvisor');
          const trader = createEmittingPluginStub('Trader');
          const analyzer = createEmittingPluginStub('RoundTripAnalyzer');
          plugins = [advisor, trader, analyzer];
          // As the circuit breaker: the advisor stops the application on an order error the Trader reports
          trader.on('orderErrored', () => {
            throw new ApplicationStopError('Max consecutive order errors reached (1)');
          });
          onOrderCompleted = vi.fn();
          trader.on('orderCompleted', onOrderCompleted);
          trader.on('portfolioChange', noop);
          analyzer.on('roundtripCompleted', noop);
          vi.mocked(trader.processInputStream).mockImplementation(async () => {
            trader.addDeferredEmit('orderErrored', { id: 1 });
            trader.addDeferredEmit('orderCompleted', { id: 2 });
            trader.addDeferredEmit('portfolioChange', { id: 3 });
            trader.addDeferredEmit('portfolioChange', { id: 4 });
          });
          vi.mocked(analyzer.processInputStream).mockImplementation(async () => {
            analyzer.addDeferredEmit('roundtripCompleted', { id: 5 });
            analyzer.addDeferredEmit('equitySnapshot', { id: 6 }); // Nobody listens to it: nothing is lost with it
          });

          await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream(plugins)).catch(noop);
        });

        it('delivers none of them', () => {
          expect(onOrderCompleted).not.toHaveBeenCalled();
        });

        it('logs, once and after the stop reason, those a plugin listens to, per plugin, as a warning', () => {
          expect(vi.mocked(warning).mock.calls).toEqual([
            ['stream', STOP_LOG],
            ['stream', DROPPED_EVENTS_LOG],
          ]);
        });

        it('logs them before finalizing the plugins, for the last flush of Supervision to send them', () => {
          const [, logCallOrder] = vi.mocked(warning).mock.invocationCallOrder;
          const [finalizeCallOrder] = vi.mocked(plugins[0].processCloseStream).mock.invocationCallOrder;
          expect(logCallOrder).toBeLessThan(finalizeCallOrder);
        });
      });

      it('logs no event dropped when the failed bucket leaves none queued', async () => {
        await writeFailingBucket(new Error('process-failed'));
        expect(warning).not.toHaveBeenCalled();
      });

      describe('when a plugin fails on the bucket while another is still processing it', () => {
        const failure = new Error('advisor failed');
        let plugins: Plugin[];
        let otherWork: ReturnType<typeof createHeldWork>;
        let streamError: Promise<Error>;

        beforeEach(async () => {
          otherWork = createHeldWork();
          plugins = [
            createPluginStub({
              processInputStream: vi.fn(async () => {
                await otherWork.started; // Fails once the other plugin has started on the bucket
                throw failure;
              }),
            }),
            createPluginStub({
              processInputStream: vi.fn(async () => {
                await otherWork.run();
              }),
            }),
          ];
          const stream = new PluginsStream(plugins);
          streamError = waitForError(stream);
          stream.write(MOCK_CANDLE);
          await otherWork.started;
          await new Promise(resolve => setImmediate(resolve)); // The first plugin has failed by then
        });

        afterEach(async () => {
          otherWork.release();
          await streamError;
        });

        it('does not finalize the plugins before the other plugin is done with the bucket', () => {
          expect(plugins[0].processCloseStream).not.toHaveBeenCalled();
        });

        it('finalizes the plugins once the other plugin is done with the bucket', async () => {
          otherWork.release();
          await streamError;
          const [finishCallOrder] = otherWork.finished.mock.invocationCallOrder;
          const [finalizeCallOrder] = vi.mocked(plugins[0].processCloseStream).mock.invocationCallOrder;
          expect(finishCallOrder).toBeLessThan(finalizeCallOrder);
        });

        it('reports the failure', async () => {
          otherWork.release();
          expect(await streamError).toBe(failure);
        });
      });

      describe('when two plugins fail on the bucket, the second before the first', () => {
        const firstError = new Error('first failure');
        const secondError = new Error('second failure');
        const firstStop = new ApplicationStopError('first stop');
        const secondStop = new ApplicationStopError('second stop');

        /** Writes a bucket both plugins of the stream fail on, the second one first: gives the error the stream emits */
        const writeBucketBothFailOn = (firstReason: unknown, secondReason: unknown) => {
          const stream = new PluginsStream([
            createPluginStub({
              emitterName: 'First',
              processInputStream: vi.fn(async () => {
                await new Promise(resolve => setImmediate(resolve)); // Once the second has failed
                throw firstReason;
              }),
            }),
            createPluginStub({
              emitterName: 'Second',
              processInputStream: vi.fn(async () => {
                throw secondReason;
              }),
            }),
          ]);
          stream.write(MOCK_CANDLE);
          return waitForError(stream);
        };

        it.each`
          reported                                                    | first         | second         | expected
          ${'the failure of the first plugin in config order'}        | ${firstError} | ${secondError} | ${firstError}
          ${'an ApplicationStopError over a failure before it'}       | ${firstError} | ${secondStop}  | ${secondStop}
          ${'an ApplicationStopError over a failure after it'}        | ${firstStop}  | ${secondError} | ${firstStop}
          ${'the first of two ApplicationStopErrors in config order'} | ${firstStop}  | ${secondStop}  | ${firstStop}
        `('reports $reported', async ({ first, second, expected }) => {
          expect(await writeBucketBothFailOn(first, second)).toBe(expected);
        });

        it.each`
          failure                                         | first         | second         | logged
          ${'of the second plugin, after the first'}      | ${firstError} | ${secondError} | ${'Second failed on the bucket as well: Error: second failure'}
          ${'of the first plugin, when the second stops'} | ${firstError} | ${secondStop}  | ${'First failed on the bucket as well: Error: first failure'}
        `('logs the other failure, $failure, with its plugin', async ({ first, second, logged }) => {
          await writeBucketBothFailOn(first, second);
          expect(error).toHaveBeenCalledWith('stream', logged);
        });

        it('logs the other failure after the reason the application closes', async () => {
          await writeBucketBothFailOn(firstError, secondError);
          expect(vi.mocked(error).mock.calls).toEqual([
            ['stream', 'Gekko is closing the application due to an error: Error: first failure'],
            ['stream', 'Second failed on the bucket as well: Error: second failure'],
          ]);
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

      it('logs why the application closes', () => {
        expect(error).toHaveBeenCalledWith('stream', 'Gekko is closing the application due to an error: Error: download failed');
      });

      it('logs why the application closes before finalizing the plugins', () => {
        const [logCallOrder] = vi.mocked(error).mock.invocationCallOrder;
        const [finalizeCallOrder] = vi.mocked(plugins[0].processCloseStream).mock.invocationCallOrder;
        expect(logCallOrder).toBeLessThan(finalizeCallOrder);
      });

      it.each`
        index | plugin
        ${0}  | ${'first'}
        ${1}  | ${'second'}
      `('finalizes the $plugin plugin exactly once', ({ index }) => {
        expect(plugins[index].processCloseStream).toHaveBeenCalledOnce();
      });
    });

    // The pipeline destroys the stream as soon as a stream upstream fails, whatever the bucket in flight is doing
    describe.each`
      work                                   | method
      ${'a plugin is processing the bucket'} | ${'processInputStream'}
      ${'a deferred event is delivered'}     | ${'broadcastDeferredEmit'}
    `('when a failure upstream destroys it while $work', ({ method }: { method: 'processInputStream' | 'broadcastDeferredEmit' }) => {
      const upstreamError = new Error('download failed');
      let plugin: Plugin;
      let heldWork: ReturnType<typeof createHeldWork>;
      let streamError: Promise<Error>;

      beforeEach(async () => {
        heldWork = createHeldWork();
        plugin = createPluginStub({ [method]: heldWork.run });
        const stream = new PluginsStream([plugin]);
        streamError = waitForError(stream);
        stream.write(MOCK_CANDLE);
        await heldWork.started;
        stream.destroy(upstreamError);
      });

      afterEach(async () => {
        heldWork.release();
        await streamError; // Settled within the test, nothing of it runs into the next one
      });

      it('does not finalize the plugins before that work is done', () => {
        expect(plugin.processCloseStream).not.toHaveBeenCalled();
      });

      it('finalizes the plugins once that work is done', async () => {
        heldWork.release();
        await streamError;
        const [finishCallOrder] = heldWork.finished.mock.invocationCallOrder;
        const [finalizeCallOrder] = vi.mocked(plugin.processCloseStream).mock.invocationCallOrder;
        expect(finishCallOrder).toBeLessThan(finalizeCallOrder);
      });

      it('finalizes the plugins exactly once', async () => {
        heldWork.release();
        await streamError;
        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('reports the error it was destroyed with', async () => {
        heldWork.release();
        expect(await streamError).toBe(upstreamError);
      });
    });

    describe('when a failure upstream destroys it while a plugin is processing a bucket it then fails on', () => {
      const upstreamError = new Error('download failed');
      let plugin: Plugin;
      let finalization: ReturnType<typeof createHeldWork>;
      let stream: PluginsStream;
      let streamError: Promise<Error>;

      beforeEach(async () => {
        const bucketWork = createHeldWork();
        finalization = createHeldWork();
        plugin = createPluginStub({
          emitterName: 'Trader',
          processInputStream: vi.fn(async () => {
            await bucketWork.run();
            throw new ApplicationStopError('Max consecutive order errors reached (5)');
          }),
          processCloseStream: vi.fn(async () => {
            await finalization.run();
          }),
          countUndeliveredPayloads: vi.fn(() => new Map([['orderCompleted', 1]])),
        });
        stream = new PluginsStream([plugin]);
        streamError = waitForError(stream);
        stream.write(MOCK_CANDLE);
        await bucketWork.started;
        stream.destroy(upstreamError);
        bucketWork.release();
        await finalization.started; // By the failed write
      });

      afterEach(async () => {
        finalization.release();
        await streamError;
      });

      it('does not close the stream before the failed write has finalized the plugins', async () => {
        await new Promise(resolve => setImmediate(resolve)); // Long enough for a premature close to happen
        expect(stream.closed).toBe(false);
      });

      it('finalizes the plugins exactly once', async () => {
        finalization.release();
        await streamError;
        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
      });

      it('reports the error it was destroyed with, not the failure of the bucket', async () => {
        finalization.release();
        expect(await streamError).toBe(upstreamError);
      });

      it('still logs the failure of the bucket', () => {
        expect(warning).toHaveBeenCalledWith('stream', 'Application stopped gracefully: [CORE] Max consecutive order errors reached (5)');
      });

      it('logs the deferred events dropped once, as the failed write does', async () => {
        finalization.release();
        await streamError;
        const droppedEventsLog =
          'Deferred events dropped as the application closes, the final reports may miss them: Trader (orderCompleted: 1)';
        expect(vi.mocked(warning).mock.calls.filter(([, message]) => message === droppedEventsLog)).toHaveLength(1);
      });
    });

    describe('when a failure upstream destroys it, with deferred events queued for the next bucket', () => {
      const DROPPED_EVENTS_LOG =
        'Deferred events dropped as the application closes, the final reports may miss them: TradingAdvisor (strategyCreateOrder: 1)';
      let advisor: Plugin;

      beforeEach(async () => {
        advisor = createEmittingPluginStub('TradingAdvisor');
        const trader = createEmittingPluginStub('Trader');
        // A strategy placing an order on a fill: it is queued on the advisor, flushed before the Trader, for the next bucket
        trader.on('orderCompleted', () => advisor.addDeferredEmit('strategyCreateOrder', { id: 2 }));
        advisor.on('strategyCreateOrder', noop);
        vi.mocked(trader.processInputStream).mockImplementation(async () => trader.addDeferredEmit('orderCompleted', { id: 1 }));
        const stream = new PluginsStream([advisor, trader]);
        await writeCandle(stream);

        const streamError = waitForError(stream);
        stream.destroy(new Error('download failed'));
        await streamError;
      });

      it('logs them, per plugin, as a warning', () => {
        expect(warning).toHaveBeenCalledWith('stream', DROPPED_EVENTS_LOG);
      });

      it('logs them after the reason the application closes', () => {
        const [reasonCallOrder] = vi.mocked(error).mock.invocationCallOrder;
        const [droppedCallOrder] = vi.mocked(warning).mock.invocationCallOrder;
        expect(reasonCallOrder).toBeLessThan(droppedCallOrder);
      });

      it('logs them before finalizing the plugins, for the last flush of Supervision to send them', () => {
        const [droppedCallOrder] = vi.mocked(warning).mock.invocationCallOrder;
        const [finalizeCallOrder] = vi.mocked(advisor.processCloseStream).mock.invocationCallOrder;
        expect(droppedCallOrder).toBeLessThan(finalizeCallOrder);
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

      it('logs why the application closes', () => {
        expect(error).toHaveBeenCalledWith('stream', 'Gekko is closing the application due to an error: Error: init failed');
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

    it('logs no error after a normal end', async () => {
      await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream([createPluginStub()]));

      expect(error).not.toHaveBeenCalled();
    });

    it('logs no event dropped after a normal end, even with events left queued', async () => {
      const plugin = createPluginStub({ countUndeliveredPayloads: vi.fn(() => new Map([['strategyCreateOrder', 1]])) });

      await pipeline(Readable.from([MOCK_CANDLE]), new PluginsStream([plugin]));

      expect(warning).not.toHaveBeenCalled();
    });

    it('logs no event dropped when destroyed without an error, even with events left queued', async () => {
      const stream = new PluginsStream([
        createPluginStub({ countUndeliveredPayloads: vi.fn(() => new Map([['strategyCreateOrder', 1]])) }),
      ]);

      stream.destroy();
      await new Promise(resolve => stream.once('close', resolve));

      expect(warning).not.toHaveBeenCalled();
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
