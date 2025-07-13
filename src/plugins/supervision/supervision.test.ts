import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Supervision } from './supervision';
import { supervisionSchema } from './supervision.schema';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'realtime', warmup: { candleCount: 0 } })),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('Supervision', () => {
  let plugin: Supervision;
  const fakeBot = { sendMessage: vi.fn(), listen: vi.fn(), close: vi.fn() };
  const baseConfig = {
    name: 'Supervision',
    token: 't',
    chatId: 1,
    cpuThreshold: 50,
    memoryThreshold: 50,
    cpuCheckInterval: 100,
    memoryCheckInterval: 100,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    plugin = new Supervision(baseConfig);
    plugin['bot'] = fakeBot as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start bot listening for processInit', () => {
    plugin['processInit']();
    expect(fakeBot.listen).toHaveBeenCalled();
  });

  it('should return running status for handleCommand /healthcheck ', () => {
    const res = plugin['handleCommand']('/healthcheck');
    expect(res).toBe('✅ Gekko is running');
  });

  it('should send alert when CPU usage exceeds threshold', async () => {
    plugin['getCpuUsage'] = vi.fn().mockReturnValue(60);
    plugin['handleCommand']('/launchcpucheck');
    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('⚠️ CPU usage exceeded'));
  });

  it('should stop CPU monitoring on command', () => {
    plugin['handleCommand']('/launchcpucheck');
    plugin['handleCommand']('/stopcpucheck');
    expect(plugin['cpuInterval']).toBeUndefined();
  });

  it('should send alert when Memory usage exceeds threshold', async () => {
    plugin['getMemoryUsage'] = vi.fn().mockReturnValue(100);
    plugin['handleCommand']('/launchmemorycheck');
    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('⚠️ Memory usage exceeded'));
  });

  it('should stop Memory monitoring on command', () => {
    plugin['handleCommand']('/launchmemorycheck');
    plugin['handleCommand']('/stopmemorycheck');
    expect(plugin['memoryInterval']).toBeUndefined();
  });

  it('getStaticConfiguration returns expected meta', () => {
    const meta = Supervision.getStaticConfiguration();
    expect(meta).toMatchObject({ name: 'Supervision', modes: ['realtime'] });
    expect(meta.schema).toBe(supervisionSchema);
  });
});
