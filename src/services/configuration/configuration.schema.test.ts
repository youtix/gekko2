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
      scenario                                | overrides                                                                         | expectSuccess
      ${'missing daterange fails validation'} | ${{}}                                                                             | ${false}
      ${'accepts valid daterange'}            | ${{ daterange: { start: ISO_START, end: ISO_END } }}                              | ${true}
      ${'respects extra optional fields'}     | ${{ daterange: { start: ISO_START, end: ISO_END }, batchSize: 500, scan: false }} | ${true}
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
      scenario                                               | overrides                                                         | expectSuccess
      ${'omitted scan still requires daterange'}             | ${{}}                                                             | ${false}
      ${'explicit scan false requires daterange'}            | ${{ scan: false }}                                                | ${false}
      ${'scan true bypasses daterange requirement'}          | ${{ scan: true }}                                                 | ${true}
      ${'daterange satisfies requirement when scan omitted'} | ${{ daterange: { start: ISO_START, end: ISO_END } }}              | ${true}
      ${'scan false with daterange succeeds'}                | ${{ scan: false, daterange: { start: ISO_START, end: ISO_END } }} | ${true}
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
  });

  it('populates defaults for optional configuration sections', () => {
    const result = configurationSchema.parse(createBaseConfig());

    expect(result.showLogo).toBe(true);
    expect(result.watch.tickrate).toBe(1000);
    expect(result.watch.timeframe).toBe('1m');
    expect(result.watch.fillGaps).toBe('empty');
    expect(result.watch.warmup).toEqual({ tickrate: 1000, candleCount: 0 });
    expect(result.watch.daterange).toBeNull();
    expect(result.exchange).toBeNull();
    expect(result.storage).toBeNull();
    expect(result[DISCLAIMER_FIELD]).toBeNull();
  });

  it.each`
    scenario                                              | plugins                      | exchange                              | disclaimer | expectSuccess
    ${'trader plugin with real exchange missing consent'} | ${[{ name: 'Trader' }]}      | ${{ name: 'binance' }}                | ${null}    | ${false}
    ${'trader plugin with disclaimer acknowledged'}       | ${[{ name: 'Trader' }]}      | ${{ name: 'binance' }}                | ${true}    | ${true}
    ${'non-trader plugin without disclaimer'}             | ${[{ name: 'paperTrader' }]} | ${{ name: 'binance' }}                | ${null}    | ${true}
    ${'trader plugin on sandboxed exchange'}              | ${[{ name: 'Trader' }]}      | ${{ name: 'binance', sandbox: true }} | ${null}    | ${true}
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
