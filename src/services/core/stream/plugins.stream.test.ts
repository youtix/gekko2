import { StopGekkoError } from '@errors/stopGekko.error';
import { Candle } from '@models/candle.types';
import { Plugin } from '@plugins/plugin';
import { info } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { PluginsStream } from './plugins.stream';

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

  it('closes plugins and surfaces StopGekkoError when a plugin fails', async () => {
    const stopError = new StopGekkoError();
    const processCloseStream = vi.fn(async () => undefined);
    const plugin = createPluginStub({
      processInputStream: vi.fn(async () => {
        throw stopError;
      }),
      processCloseStream,
    });

    const stream = new PluginsStream([plugin]);

    const errorPromise = new Promise<Error>(resolve => stream.once('error', resolve));
    stream.write({} as Candle);

    const receivedError = await errorPromise;

    expect(receivedError).toBe(stopError);
    expect(processCloseStream).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('stream', 'Gekko is closing the application !');
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
});
