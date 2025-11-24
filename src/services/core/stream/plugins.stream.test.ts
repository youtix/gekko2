import { Candle } from '@models/candle.types';
import { Plugin } from '@plugins/plugin';
import { info } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { PluginsStream } from './plugins.stream';

const { injectMock } = vi.hoisted(() => ({
  injectMock: {
    exchange: vi.fn(() => ({
      getExchangeName: (): string => 'binance',
    })),
  },
}));

vi.mock('@services/injecter/injecter', () => ({
  inject: injectMock,
}));

vi.mock('@services/logger', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

describe('PluginsStream', () => {
  const createPluginStub = (overrides?: Partial<Plugin>) =>
    ({
      processInitStream: vi.fn(async () => undefined),
      processInputStream: vi.fn(async () => undefined),
      processCloseStream: vi.fn(async () => undefined),
      broadcastDeferredEmit: vi.fn(async () => false),
      ...overrides,
    }) as unknown as Plugin;

  describe('_construct', () => {
    it('initializes every plugin before signaling readiness', async () => {
      const firstPlugin = createPluginStub();
      const secondPlugin = createPluginStub();
      const stream = new PluginsStream([firstPlugin, secondPlugin]);

      await new Promise<void>((resolve, reject) => {
        stream._construct(error => {
          if (error) reject(error);
          else resolve();
        });
      });

      expect(firstPlugin.processInitStream).toHaveBeenCalledTimes(1);
      expect(secondPlugin.processInitStream).toHaveBeenCalledTimes(1);
    });

    it('passes initialization errors to the callback', async () => {
      const initError = new Error('init failed');
      const plugin = createPluginStub({
        processInitStream: vi.fn(async () => {
          throw initError;
        }),
      });
      const stream = new PluginsStream([plugin]);
      const errorEvent = new Promise<Error>(resolve => {
        stream.once('error', resolve);
      });
      const result = await new Promise<Error | undefined>(resolve => {
        stream._construct(error => {
          resolve(error ?? undefined);
        });
      });

      expect(result).toBe(initError);
      await expect(errorEvent).resolves.toBe(initError);
    });
  });

  it('invokes plugin finalizers once when the stream ends', async () => {
    const processCloseStream = vi.fn(async () => undefined);
    const plugin = createPluginStub({ processCloseStream });
    const stream = new PluginsStream([plugin]);

    await new Promise<void>(resolve => {
      stream.on('finish', resolve);
      stream.end();
    });

    expect(processCloseStream).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('stream', 'Gekko is closing the application !');
  });

  it('forwards candles to the dummy exchange before plugin processing', async () => {
    const callOrder: string[] = [];
    const dummyExchange = {
      processOneMinuteCandle: vi.fn(() => {
        callOrder.push('exchange');
      }),
      getExchangeName: () => 'dummy-cex',
    };
    injectMock.exchange.mockReturnValue(dummyExchange);

    const plugin = createPluginStub({
      processInputStream: vi.fn(async () => {
        callOrder.push('plugin');
      }),
    });

    const stream = new PluginsStream([plugin]);

    await new Promise<void>((resolve, reject) => {
      stream.write({} as Candle, error => {
        if (error) reject(error);
        else resolve();
      });
    });

    expect(callOrder).toEqual(['exchange', 'plugin']);
  });
});
