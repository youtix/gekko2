import { unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configPath = resolve(__dirname, 'temp-config.json');

const configContent = {
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
};

describe('Configuration service', () => {
  beforeEach(() => {
    writeFileSync(configPath, JSON.stringify(configContent));
    process.env.GEKKO_CONFIG_FILE_PATH = configPath;
    vi.resetModules();
  });

  afterEach(() => {
    unlinkSync(configPath);
    delete process.env.GEKKO_CONFIG_FILE_PATH;
  });

  it('loads JSON configuration files', async () => {
    const { config } = await import('./configuration');
    expect(config.getWatch().mode).toBe('realtime');
  });
});
