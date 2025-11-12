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
      processInputStream: vi.fn(async () => undefined),
      processCloseStream: vi.fn(async () => undefined),
      broadcastDeferredEmit: vi.fn(() => false),
      ...overrides,
    }) as unknown as Plugin;

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
