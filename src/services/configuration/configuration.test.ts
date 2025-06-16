import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

const configPath = resolve(__dirname, 'temp-config.json');

const configContent = {
  showLogo: false,
  watch: { asset: 'BTC', currency: 'USDT', mode: 'realtime', fillGaps: 'no' },
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
