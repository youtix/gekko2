import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() =>
    JSON.stringify({
      showLogo: false,
      watch: {
        asset: 'BTC',
        currency: 'USDT',
        mode: 'realtime',
        timeframe: '1d',
        fillGaps: 'no',
        warmup: { candleCount: 0 },
      },
      plugins: [{ name: 'PerformanceAnalyzer' }],
      strategy: { name: 'demo' },
      exchange: { name: 'dummy-cex' },
    }),
  ),
}));

describe('Configuration service', () => {
  process.env.GEKKO_CONFIG_FILE_PATH = './path/to/config/file.json';

  beforeAll(() => {
    vi.resetModules();
  });

  it('loads JSON configuration files', async () => {
    const { config } = await import('./configuration');
    expect(config.getWatch().mode).toBe('realtime');
  });
});
