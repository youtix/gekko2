import { Candle } from '@models/candle.types';
import { Plugin } from '@plugins/plugin';
import { info, warning } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
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
      it('finalizes all plugins before destroying stream', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw new Error('processing failed');
          }),
        });
        const stream = new PluginsStream([plugin]);

        const error = await Promise.race([waitForError(stream), writeCandle(stream).catch(e => e)]);
        stream.write(MOCK_CANDLE);

        expect(plugin.processCloseStream).toHaveBeenCalledOnce();
        expect((error as Error).message).toBe('processing failed');
      });

      it('logs closing message on error', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw new Error('fail');
          }),
        });
        const stream = new PluginsStream([plugin]);
        stream.write(MOCK_CANDLE);

        await waitForError(stream);

        expect(info).toHaveBeenCalledWith('stream', 'Gekko is closing the application due to an error!');
      });

      it('converts non-Error thrown values to Error', async () => {
        injectMock.exchange.mockReturnValue({ getExchangeName: () => 'binance' });
        const plugin = createPluginStub({
          processInputStream: vi.fn(async () => {
            throw 'string error';
          }),
        });
        const stream = new PluginsStream([plugin]);
        stream.write(MOCK_CANDLE);

        const error = await waitForError(stream);

        expect(error.message).toBe('string error');
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
});
