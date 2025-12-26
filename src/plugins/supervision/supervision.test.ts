import { getBufferedLogs } from '@services/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Supervision } from './supervision';
import { supervisionSchema } from './supervision.schema';

vi.mock('@services/logger', () => ({ debug: vi.fn(), getBufferedLogs: vi.fn(() => []) }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({ mode: 'realtime', warmup: { candleCount: 0 } })),
      getStrategy: vi.fn(() => ({})),
      showLogo: vi.fn(),
      getPlugins: vi.fn(),
      getStorage: vi.fn(),
      getExchange: vi.fn(),
    };
  });
  return { config: new Configuration() };
});

describe('Supervision', () => {
  let plugin: Supervision;
  const fakeBot = { sendMessage: vi.fn(), listen: vi.fn(), close: vi.fn() };
  const baseConfig = {
    name: 'Supervision',
    token: 't',
    botUsername: 'bot-name',
    chatId: 1,
    cpuThreshold: 50,
    memoryThreshold: 50,
    cpuCheckInterval: 100,
    memoryCheckInterval: 100,
    logMonitoringInterval: 100,
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

  it('should send alert when timeframe candle differs from exchange', async () => {
    const exchangeCandle = { open: 1, high: 2, low: 1, close: 2, volume: 10 };
    const timeframeCandle = { open: 2, high: 3, low: 1, close: 3, volume: 11 };
    plugin['getExchange'] = vi.fn().mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([exchangeCandle]),
    });
    plugin['handleCommand']('/launchtimeframecandlecheck');
    await plugin.onTimeframeCandle([timeframeCandle as any]);
    const message = (fakeBot.sendMessage as any).mock.calls[0][0];
    expect(message).toContain('⚠️ Timeframe candle mismatch detected');
    expect(message).toContain('open: 1 | 2');
    expect(message).toContain('high: 2 | 3');
    expect(message).toContain('close: 2 | 3');
    expect(message).toContain('volume: 10 | 11');
  });

  it('should stop timeframe candle monitoring on command', async () => {
    const exchangeCandle = { open: 1, high: 2, low: 1, close: 2, volume: 10 };
    const timeframeCandle = { open: 2, high: 3, low: 1, close: 3, volume: 11 };
    plugin['getExchange'] = vi.fn().mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([exchangeCandle]),
    });
    plugin['handleCommand']('/launchtimeframecandlecheck');
    plugin['handleCommand']('/stoptimeframecandlecheck');
    await plugin.onTimeframeCandle([timeframeCandle as any]);
    expect(fakeBot.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('⚠️ Timeframe candle mismatch detected'),
    );
  });

  it('should start and stop log monitoring on command', () => {
    plugin['handleCommand']('/startlogmonitoring');
    expect(plugin['logMonitorInterval']).toBeDefined();
    plugin['handleCommand']('/stoplogmonitoring');
    expect(plugin['logMonitorInterval']).toBeUndefined();
  });

  it('should send warning and error logs from buffer', async () => {
    const logs = [
      { timestamp: 1, level: 'info', tag: 'gekko', message: 'm1' },
      { timestamp: 2, level: 'warning', tag: 'gekko', message: 'm2' },
    ];
    vi.mocked(getBufferedLogs).mockReturnValue(logs as any);
    plugin['handleCommand']('/startlogmonitoring');

    const newLogs = [...logs, { timestamp: 3, level: 'error', tag: 'gekko', message: 'm3' }];
    vi.mocked(getBufferedLogs).mockReturnValue(newLogs as any);

    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('m3'));
  });

  it('getStaticConfiguration returns expected meta', () => {
    const meta = Supervision.getStaticConfiguration();
    expect(meta).toMatchObject({ name: 'Supervision', modes: ['realtime'] });
    expect(meta.schema).toBe(supervisionSchema);
  });
});
