import { describe, expect, it } from 'vitest';
import { configurationSchema, watchSchema } from './configuration.schema';

const DISCLAIMER_FIELD = 'I understand that Gekko only automates MY OWN trading strategies' as const;

const ISO_START = '2023-01-01T00:00:00.000Z';
const ISO_END = '2023-01-02T00:00:00.000Z';

describe('watchSchema', () => {
  const baseWatch = {
    currency: 'USD',
    asset: 'BTC',
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
      expect(result.timeframe).toBe('1m');
      expect(result.fillGaps).toBe('empty');
      expect(result.warmup).toEqual({ tickrate: 1000, candleCount: 0 });
      expect(result.daterange).toBeNull();
    });
  });
});

describe('configurationSchema', () => {
  const createBaseConfig = () => ({
    watch: {
      currency: 'USD',
      asset: 'BTC',
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
    expect(result.watch.timeframe).toBe('1m');
    expect(result.watch.fillGaps).toBe('empty');
    expect(result.watch.warmup).toEqual({ tickrate: 1000, candleCount: 0 });
    expect(result.watch.daterange).toBeNull();
    expect(result.exchange).toMatchObject({
      name: 'dummy-cex',
      sandbox: false,
      verbose: false,
      exchangeSynchInterval: 600000,
      orderSynchInterval: 2000,
    });
    expect(result.storage).toBeNull();
    expect(result[DISCLAIMER_FIELD]).toBeNull();
  });

  const traderPlugin = [{ name: 'Trader' }];
  const paperTraderPlugin = [{ name: 'paperTrader' }];
  const binanceExchange = { name: 'binance' };
  const sandboxExchange = { name: 'binance', sandbox: true };

  it.each`
    scenario                                              | plugins              | exchange           | disclaimer | expectSuccess
    ${'trader plugin with real exchange missing consent'} | ${traderPlugin}      | ${binanceExchange} | ${null}    | ${false}
    ${'trader plugin with disclaimer acknowledged'}       | ${traderPlugin}      | ${binanceExchange} | ${true}    | ${true}
    ${'non-trader plugin without disclaimer'}             | ${paperTraderPlugin} | ${binanceExchange} | ${null}    | ${true}
    ${'trader plugin on sandboxed exchange'}              | ${traderPlugin}      | ${sandboxExchange} | ${null}    | ${true}
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
