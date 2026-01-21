import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

describe('Configuration Service', () => {
  const mockConfig = {
    showLogo: true,
    watch: {
      pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
      mode: 'realtime',
      fillGaps: 'no',
      warmup: { candleCount: 100, tickrate: 1000 },
      tickrate: 1000,
    },
    plugins: [{ name: 'PerformanceAnalyzer' }],
    strategy: { name: 'CCI' },
    exchange: {
      name: 'dummy-cex',
      simulationBalance: [
        { assetName: 'BTC', balance: 1 },
        { assetName: 'USDT', balance: 10000 },
      ],
    },
  };

  const setConfigFile = (path: string | undefined, content: unknown) => {
    if (path) process.env.GEKKO_CONFIG_FILE_PATH = path;
    else delete process.env.GEKKO_CONFIG_FILE_PATH;

    vi.mocked(readFileSync).mockReturnValue(typeof content === 'string' ? content : JSON.stringify(content));
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.GEKKO_CONFIG_FILE_PATH = 'config.json';
  });

  describe('Initialization', () => {
    it('should throw error if GEKKO_CONFIG_FILE_PATH is missing', async () => {
      setConfigFile(undefined, mockConfig);

      await expect(import('./configuration')).rejects.toThrow('Missing GEKKO_CONFIG_FILE_PATH environment variable');
    }, 10000);

    it.each([
      ['config.json', JSON.stringify(mockConfig)],
      ['config.json5', JSON.stringify(mockConfig)],
    ])('should load valid JSON/JSON5 config from %s', async (path, content) => {
      setConfigFile(path, content);
      const { config } = await import('./configuration');

      expect(config.getWatch()).toEqual(mockConfig.watch);
    });

    it.each([
      [
        'config.yaml',
        'showLogo: true\nwatch:\n  pairs:\n    - symbol: BTC/USDT\n      timeframe: 1m\n  mode: realtime\n  fillGaps: "no"\n  warmup:\n    candleCount: 100\nplugins:\n  - name: PerformanceAnalyzer\nstrategy:\n  name: CCI\nexchange:\n  name: dummy-cex\n  simulationBalance:\n    - assetName: BTC\n      balance: 1\n    - assetName: USDT\n      balance: 10000',
      ],
      [
        'config.yml',
        'showLogo: true\nwatch:\n  pairs:\n    - symbol: BTC/USDT\n      timeframe: 1m\n  mode: realtime\n  fillGaps: "no"\n  warmup:\n    candleCount: 100\nplugins:\n  - name: PerformanceAnalyzer\nstrategy:\n  name: CCI\nexchange:\n  name: dummy-cex\n  simulationBalance:\n    - assetName: BTC\n      balance: 1\n    - assetName: USDT\n      balance: 10000',
      ],
    ])('should load valid YAML config from %s', async (path, content) => {
      setConfigFile(path, content);
      const { config } = await import('./configuration');

      expect(config.getWatch()).toEqual(mockConfig.watch);
    });

    it('should throw validation error for invalid config', async () => {
      setConfigFile('config.json', { ...mockConfig, watch: 'invalid' });
      await expect(import('./configuration')).rejects.toThrow();
    });

    it('should throw error for empty content', async () => {
      vi.mocked(readFileSync).mockReturnValue('');
      await expect(import('./configuration')).rejects.toThrow();
    });
  });

  describe('Methods', () => {
    let configInstance: any;

    beforeEach(async () => {
      setConfigFile('config.json', mockConfig);
      const { config } = await import('./configuration');
      configInstance = config;
    });

    describe('showLogo', () => {
      it('should return showLogo value', () => {
        expect(configInstance.showLogo()).toBe(true);
      });

      it('should throw if configuration is missing (simulated)', async () => {
        // Force private property to undefined using type casting and violation
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.showLogo()).toThrow('Empty configuration file');
      });
    });

    describe('getPlugins', () => {
      it('should return plugins', () => {
        expect(configInstance.getPlugins()).toEqual(mockConfig.plugins);
      });

      it('should throw if configuration is missing', () => {
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.getPlugins()).toThrow('Empty configuration file');
      });
    });

    describe('getStrategy', () => {
      it('should return strategy', () => {
        expect(configInstance.getStrategy()).toEqual(mockConfig.strategy);
      });

      it('should throw if configuration is missing', () => {
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.getStrategy()).toThrow('Empty configuration file');
      });
    });

    describe('getExchange', () => {
      it('should return exchange', () => {
        const exchange = configInstance.getExchange();
        expect(exchange.name).toBe('dummy-cex');
        expect(exchange.simulationBalance).toBeInstanceOf(Map);
        expect(exchange.simulationBalance.get('BTC')).toBe(1);
        expect(exchange.simulationBalance.get('USDT')).toBe(10000);
      });

      it('should throw if configuration is missing', () => {
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.getExchange()).toThrow('Empty configuration file');
      });
    });

    describe('getWatch', () => {
      it('should return watch config', () => {
        expect(configInstance.getWatch()).toEqual(mockConfig.watch);
      });

      it('should throw if configuration is missing', () => {
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.getWatch()).toThrow('Empty configuration file');
      });

      it('should validate daterange in importer mode', async () => {
        const importerConfig = {
          ...mockConfig,
          watch: {
            ...mockConfig.watch,
            mode: 'importer',
            daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-02T00:00:00Z' },
          },
        };
        setConfigFile('config.json', importerConfig);
        vi.resetModules();
        const { config } = await import('./configuration');

        expect(config.getWatch()).toEqual({
          ...importerConfig.watch,
          daterange: {
            start: new Date(importerConfig.watch.daterange.start).getTime(),
            end: new Date(importerConfig.watch.daterange.end).getTime(),
          },
        });
      });

      it('should throw on invalid daterange in importer mode', async () => {
        const invalidRangeConfig = {
          ...mockConfig,
          watch: {
            ...mockConfig.watch,
            mode: 'importer',
            daterange: { start: '2023-01-02T00:00:00Z', end: '2023-01-01T00:00:00Z' },
          },
        };
        setConfigFile('config.json', invalidRangeConfig);
        vi.resetModules();
        const { config } = await import('./configuration');

        expect(() => config.getWatch()).toThrow(/Wrong date range/);
      });

      it('should throw on invalid daterange in backtest mode', async () => {
        const invalidRangeConfig = {
          ...mockConfig,
          watch: {
            ...mockConfig.watch,
            mode: 'backtest',
            daterange: { start: '2023-01-02T00:00:00Z', end: '2023-01-01T00:00:00Z' },
          },
        };
        setConfigFile('config.json', invalidRangeConfig);
        vi.resetModules();
        const { config } = await import('./configuration');

        expect(() => config.getWatch()).toThrow(/Wrong date range/);
      });
    });

    describe('getStorage', () => {
      it('should return undefined if not configured and not needed', () => {
        expect(configInstance.getStorage()).toBeUndefined();
      });

      it('should throw if configuration is missing', () => {
        (configInstance as any).configuration = undefined;
        expect(() => configInstance.getStorage()).toThrow('Empty configuration file');
      });

      it('should return storage when in backtest mode', async () => {
        const backtestConfig = {
          ...mockConfig,
          watch: {
            ...mockConfig.watch,
            mode: 'backtest',
            daterange: { start: '2023-01-01T00:00:00Z', end: '2023-01-02T00:00:00Z' },
          },
          storage: { type: 'sqlite', database: 'gekko.db' },
        };
        setConfigFile('config.json', backtestConfig);
        vi.resetModules();
        const { config } = await import('./configuration');
        expect(config.getStorage()).toEqual(backtestConfig.storage);
      });

      it('should return storage when CandleWriter plugin is present', async () => {
        const writerConfig = {
          ...mockConfig,
          plugins: [{ name: 'CandleWriter' }],
          storage: { type: 'sqlite', database: 'gekko.db' },
        };
        setConfigFile('config.json', writerConfig);
        vi.resetModules();
        const { config } = await import('./configuration');
        expect(config.getStorage()).toEqual(writerConfig.storage);
      });
    });
  });
});
