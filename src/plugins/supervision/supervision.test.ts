import { getBufferedLogs } from '@services/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Supervision } from './supervision';
import { supervisionSchema } from './supervision.schema';
import { SUBSCRIPTION_NAMES } from './supervision.types';

vi.mock('@services/logger', () => ({ debug: vi.fn(), getBufferedLogs: vi.fn(() => []) }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({
        pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
        mode: 'realtime',
        warmup: { candleCount: 0 },
      })),
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
    plugin['handleCommand']('/sub_cpu_check');
    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('⚠️ CPU usage exceeded'));
  });

  it('should stop CPU monitoring on unsubscribe', () => {
    plugin['handleCommand']('/sub_cpu_check');
    plugin['handleCommand']('/sub_cpu_check');
    expect(plugin['cpuInterval']).toBeUndefined();
  });

  it('should send alert when Memory usage exceeds threshold', async () => {
    plugin['getMemoryUsage'] = vi.fn().mockReturnValue(100);
    plugin['handleCommand']('/sub_memory_check');
    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('⚠️ Memory usage exceeded'));
  });

  it('should stop Memory monitoring on unsubscribe', () => {
    plugin['handleCommand']('/sub_memory_check');
    plugin['handleCommand']('/sub_memory_check');
    expect(plugin['memoryInterval']).toBeUndefined();
  });

  it('should send alert when timeframe candle differs from exchange', async () => {
    const exchangeCandle = { open: 1, high: 2, low: 1, close: 2, volume: 10 };
    const timeframeCandle = { open: 2, high: 3, low: 1, close: 3, volume: 11 };
    plugin['getExchange'] = vi.fn().mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([exchangeCandle]),
    });
    plugin['handleCommand']('/sub_candle_check');
    await plugin.onTimeframeCandle([timeframeCandle as any]);
    const message = (fakeBot.sendMessage as any).mock.calls[0][0];
    expect(message).toContain('⚠️ Timeframe candle mismatch detected');
    expect(message).toContain('open: 1 | 2');
    expect(message).toContain('high: 2 | 3');
    expect(message).toContain('close: 2 | 3');
    expect(message).toContain('volume: 10 | 11');
  });

  it('should stop timeframe candle monitoring on unsubscribe', async () => {
    const exchangeCandle = { open: 1, high: 2, low: 1, close: 2, volume: 10 };
    const timeframeCandle = { open: 2, high: 3, low: 1, close: 3, volume: 11 };
    plugin['getExchange'] = vi.fn().mockReturnValue({
      fetchOHLCV: vi.fn().mockResolvedValue([exchangeCandle]),
    });
    plugin['handleCommand']('/sub_candle_check');
    plugin['handleCommand']('/sub_candle_check');
    await plugin.onTimeframeCandle([timeframeCandle as any]);
    expect(fakeBot.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('⚠️ Timeframe candle mismatch detected'),
    );
  });

  it('should start and stop log monitoring on subscription toggle', () => {
    plugin['handleCommand']('/sub_monitor_log');
    expect(plugin['logMonitorInterval']).toBeDefined();
    plugin['handleCommand']('/sub_monitor_log');
    expect(plugin['logMonitorInterval']).toBeUndefined();
  });

  it('should send warning and error logs from buffer', async () => {
    const logs = [
      { timestamp: 1, level: 'info', tag: 'gekko', message: 'm1' },
      { timestamp: 2, level: 'warning', tag: 'gekko', message: 'm2' },
    ];
    vi.mocked(getBufferedLogs).mockReturnValue(logs as any);
    plugin['handleCommand']('/sub_monitor_log');

    const newLogs = [...logs, { timestamp: 3, level: 'error', tag: 'gekko', message: 'm3' }];
    vi.mocked(getBufferedLogs).mockReturnValue(newLogs as any);

    await vi.advanceTimersByTimeAsync(100);
    expect(fakeBot.sendMessage).toHaveBeenCalledWith(expect.stringContaining('m3'));
  });

  it('should return help information', () => {
    const res = plugin['handleCommand']('/help');
    expect(res).toBe(`healthcheck - Check if gekko is up
sub_cpu_check - Check CPU usage
sub_memory_check - Check memory usage
sub_candle_check - Check timeframe candle calculations
sub_monitor_log - Monitor log application
subscribe_all - Subscribe to all notifications
unsubscribe_all - Unsubscribe from all notifications
subscriptions - View current subscriptions
help - Show help information`);
  });

  it('should subscribe to all monitoring', () => {
    plugin['handleCommand']('/subscribe_all');
    expect(plugin['subscriptions'].size).toBe(SUBSCRIPTION_NAMES.length);
  });

  it('should unsubscribe from all monitoring', () => {
    plugin['handleCommand']('/subscribe_all');
    plugin['handleCommand']('/unsubscribe_all');
    expect(plugin['subscriptions'].size).toBe(0);
  });

  it('should list current subscriptions', () => {
    plugin['handleCommand']('/sub_cpu_check');
    const res = plugin['handleCommand']('/subscriptions');
    expect(res).toBe('cpu_check');
  });

  it('should return no subscriptions when empty', () => {
    const res = plugin['handleCommand']('/subscriptions');
    expect(res).toBe('No subscriptions');
  });

  it('getStaticConfiguration returns expected meta', () => {
    const meta = Supervision.getStaticConfiguration();
    expect(meta).toMatchObject({ name: 'Supervision', modes: ['realtime'] });
    expect(meta.schema).toBe(supervisionSchema);
  });
});
