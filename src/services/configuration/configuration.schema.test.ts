import { pairConfigSchema, pairsSchema } from '@models/schema/pairConfig.schema';
import { describe, expect, it } from 'vitest';
import { configurationSchema, watchSchema } from './configuration.schema';

const DISCLAIMER_FIELD = 'I understand that Gekko only automates MY OWN trading strategies' as const;

const ISO_START = '2023-01-01T00:00:00.000Z';
const ISO_END = '2023-01-02T00:00:00.000Z';

// Base pairs for v3 config format
const basePairs = [{ symbol: 'BTC/USDT', timeframe: '1h' as const }];

describe('pairConfigSchema', () => {
  it('accepts valid pair config', () => {
    const result = pairConfigSchema.safeParse({ symbol: 'BTC/USDT', timeframe: '1h' });
    expect(result.success).toBe(true);
  });

  it('rejects missing symbol', () => {
    const result = pairConfigSchema.safeParse({ timeframe: '1h' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['symbol'] });
  });

  it('rejects empty symbol', () => {
    const result = pairConfigSchema.safeParse({ symbol: '', timeframe: '1h' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Symbol must contain a slash');
  });

  it('rejects invalid timeframe', () => {
    const result = pairConfigSchema.safeParse({ symbol: 'BTC/USDT', timeframe: 'invalid' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['timeframe'] });
  });
});

describe('pairsSchema', () => {
  it('accepts valid config with 2 pairs', () => {
    const pairs = [
      { symbol: 'BTC/USDT', timeframe: '1h' },
      { symbol: 'ETH/USDT', timeframe: '4h' },
    ];
    const result = pairsSchema.safeParse(pairs);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('accepts maximum of 5 pairs', () => {
    const pairs = [
      { symbol: 'BTC/USDT', timeframe: '1h' },
      { symbol: 'ETH/USDT', timeframe: '4h' },
      { symbol: 'SOL/USDT', timeframe: '1h' },
      { symbol: 'AVAX/USDT', timeframe: '15m' },
      { symbol: 'LINK/USDT', timeframe: '1d' },
    ];
    const result = pairsSchema.safeParse(pairs);
    expect(result.success).toBe(true);
  });

  it('rejects config with 6 pairs with specific error message', () => {
    const pairs = [
      { symbol: 'BTC/USDT', timeframe: '1h' },
      { symbol: 'ETH/USDT', timeframe: '4h' },
      { symbol: 'SOL/USDT', timeframe: '1h' },
      { symbol: 'AVAX/USDT', timeframe: '15m' },
      { symbol: 'LINK/USDT', timeframe: '1d' },
      { symbol: 'DOT/USDT', timeframe: '1h' },
    ];
    const result = pairsSchema.safeParse(pairs);
    expect(result.success).toBe(false);
    // Check for the "Maximum 5 pairs allowed" message
    const hasMaxPairsError = result.error?.issues.some(
      issue => issue.message.includes('Maximum 5 pairs allowed') || issue.message.includes('5'),
    );
    expect(hasMaxPairsError).toBe(true);
  });

  it('rejects empty pairs array', () => {
    const result = pairsSchema.safeParse([]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('At least one pair is required');
  });

  it('rejects pair with missing symbol', () => {
    const pairs = [{ timeframe: '1h' }];
    const result = pairsSchema.safeParse(pairs);
    expect(result.success).toBe(false);
  });

  it('rejects pair with invalid timeframe', () => {
    const pairs = [{ symbol: 'BTC/USDT', timeframe: 'invalid' }];
    const result = pairsSchema.safeParse(pairs);
    expect(result.success).toBe(false);
  });
});

describe('watchSchema', () => {
  const baseWatch = {
    pairs: basePairs,
  };

  describe('importer mode', () => {
    const importerBase = { ...baseWatch, mode: 'importer' as const };

    it.each`
      scenario                                | overrides                                                            | expectSuccess
      ${'missing daterange fails validation'} | ${{}}                                                                | ${false}
      ${'accepts valid daterange'}            | ${{ daterange: { start: ISO_START, end: ISO_END } }}                 | ${true}
      ${'respects extra optional fields'}     | ${{ daterange: { start: ISO_START, end: ISO_END }, batchSize: 500 }} | ${true}
    `('$scenario', ({ overrides, expectSuccess }) => {
      const candidate: Record<string, unknown> = {
        ...importerBase,
        daterange: null,
        ...overrides,
      };

      const result = watchSchema.safeParse(candidate);

      if (expectSuccess) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]).toMatchObject({ path: ['daterange'] });
      }
    });
  });

  describe('backtest mode', () => {
    const backtestBase = { ...baseWatch, mode: 'backtest' as const };

    it.each`
      scenario                                | overrides                                                            | expectSuccess
      ${'missing daterange fails validation'} | ${{}}                                                                | ${false}
      ${'accepts valid daterange'}            | ${{ daterange: { start: ISO_START, end: ISO_END } }}                 | ${true}
      ${'respects extra optional fields'}     | ${{ daterange: { start: ISO_START, end: ISO_END }, batchSize: 500 }} | ${true}
    `('$scenario', ({ overrides, expectSuccess }) => {
      const candidate: Record<string, unknown> = {
        ...backtestBase,
        daterange: null,
        ...overrides,
      };

      const result = watchSchema.safeParse(candidate);

      if (expectSuccess) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]).toMatchObject({ path: ['daterange'] });
      }
    });
  });

  describe('realtime mode', () => {
    it('applies defaults while leaving daterange optional', () => {
      const candidate = {
        ...baseWatch,
        mode: 'realtime' as const,
      };

      const result = watchSchema.parse(candidate);

      expect(result.tickrate).toBe(1000);
      expect(result.pairs).toEqual(basePairs);
      expect(result.fillGaps).toBe('empty');
      expect(result.warmup).toEqual({ tickrate: 1000, candleCount: 0 });
      expect(result.daterange).toBeUndefined();
    });
  });
});

describe('configurationSchema', () => {
  const createBaseConfig = () => ({
    watch: {
      pairs: basePairs,
      mode: 'realtime' as const,
    },
    plugins: [] as Array<{ name?: string }>,
    exchange: {
      name: 'dummy-cex' as const,
    },
  });

  it('populates defaults for optional configuration sections', () => {
    const result = configurationSchema.parse(createBaseConfig());

    expect(result.showLogo).toBe(true);
    expect(result.watch.tickrate).toBe(1000);
    expect(result.watch.pairs).toEqual(basePairs);
    expect(result.watch.fillGaps).toBe('empty');
    expect(result.watch.warmup).toEqual({ tickrate: 1000, candleCount: 0 });
    expect(result.watch.daterange).toBeUndefined();
    expect(result.exchange).toMatchObject({
      name: 'dummy-cex',
      exchangeSynchInterval: 600000,
      orderSynchInterval: 20000,
    });
    expect(result.storage).toBeNull();
    expect(result[DISCLAIMER_FIELD]).toBeNull();
  });

  const traderPlugin = [{ name: 'Trader' }];
  const OtherPlugin = [{ name: 'Other' }];
  const binanceExchange = { name: 'binance', apiKey: 'test', secret: 'test' };
  const sandboxExchange = { name: 'binance', sandbox: true, apiKey: 'test', secret: 'test' };

  it.each`
    scenario                                              | plugins         | exchange           | disclaimer | expectSuccess
    ${'trader plugin with real exchange missing consent'} | ${traderPlugin} | ${binanceExchange} | ${null}    | ${false}
    ${'trader plugin with disclaimer acknowledged'}       | ${traderPlugin} | ${binanceExchange} | ${true}    | ${true}
    ${'non-trader plugin without disclaimer'}             | ${OtherPlugin}  | ${binanceExchange} | ${null}    | ${true}
    ${'trader plugin on sandboxed exchange'}              | ${traderPlugin} | ${sandboxExchange} | ${null}    | ${true}
  `('enforces disclaimer requirements when $scenario', ({ plugins, exchange, disclaimer, expectSuccess }) => {
    const configInput: Record<string, unknown> = {
      ...createBaseConfig(),
      plugins,
      exchange,
    };

    if (disclaimer !== undefined) {
      configInput[DISCLAIMER_FIELD] = disclaimer;
    }

    const result = configurationSchema.safeParse(configInput);

    if (expectSuccess) {
      expect(result.success).toBe(true);
    } else {
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        path: [DISCLAIMER_FIELD],
      });
    }
  });
});
