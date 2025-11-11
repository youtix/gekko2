import { OrderCompleted } from '@models/order.types';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Report } from './performanceAnalyzer.types';

const infoMock = vi.fn();
const debugMock = vi.fn();
const toISOStringMock = vi.fn();
const roundMock = vi.fn();
const formatRatioMock = vi.fn();

vi.mock('@services/logger', () => ({
  info: infoMock,
  debug: debugMock,
}));

vi.mock('@utils/date/date.utils', () => ({
  toISOString: toISOStringMock,
}));

vi.mock('@utils/math/round.utils', () => ({
  round: roundMock,
}));

vi.mock('@utils/string/string.utils', async () => {
  const actual = await vi.importActual<typeof import('@utils/string/string.utils')>('@utils/string/string.utils');
  return {
    ...actual,
    formatRatio: formatRatioMock,
  };
});

let logFinalize: typeof import('./performanceAnalyzer.utils').logFinalize;
let logTrade: typeof import('./performanceAnalyzer.utils').logTrade;
beforeAll(async () => {
  ({ logFinalize, logTrade } = await import('./performanceAnalyzer.utils'));
});

describe('performanceAnalyzer.utils', () => {
  beforeEach(() => {
    toISOStringMock.mockImplementation((value: EpochTimeStamp) => `iso(${value})`);
    roundMock.mockImplementation((value: number, decimals = 0, mode: 'down' | 'up' | 'halfEven' = 'up') => {
      const factor = 10 ** decimals;
      if (mode === 'down') return Math.floor(value * factor) / factor;
      if (mode === 'up') return Math.round(value * factor) / factor;
      const scaled = value * factor;
      const floor = Math.floor(scaled);
      const fraction = scaled - floor;
      if (fraction > 0.5) return (floor + 1) / factor;
      if (fraction < 0.5) return floor / factor;
      return (floor % 2 === 0 ? floor : floor + 1) / factor;
    });
    formatRatioMock.mockImplementation((ratio: number) => `ratio(${ratio})`);
  });

  describe('logFinalize', () => {
    const report: Report = {
      startTime: 1_700_000_000,
      endTime: 1_700_100_000,
      duration: '1h',
      market: 12.34,
      balance: 5050,
      profit: 250,
      relativeProfit: 4.95,
      yearlyProfit: 730,
      relativeYearlyProfit: 15.12,
      startPrice: 21_000,
      endPrice: 22_250,
      orders: 7,
      startBalance: 4800,
      exposure: 55.678,
      sharpe: 1.5,
      sortino: 1.1,
      standardDeviation: 0.75,
      downside: 9.87,
      alpha: 2.56,
    };

    let consoleTableMock: ReturnType<typeof vi.fn>;
    let numberFormatSpy: ReturnType<typeof vi.spyOn>;
    let numberFormatFormatMock: ReturnType<typeof vi.fn>;
    let consoleTableSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleTableMock = vi.fn();
      numberFormatFormatMock = vi.fn((value: number) => `formatted(${value})`);
      // @ts-expect-error to fix one day
      numberFormatSpy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => ({ format: numberFormatFormatMock }) as unknown as Intl.NumberFormat);
      consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(consoleTableMock);
    });

    afterEach(() => {
      numberFormatSpy.mockRestore();
      consoleTableSpy.mockRestore();
    });

    it.each`
      enableConsoleTable | expectedCalls
      ${true}            | ${1}
      ${false}           | ${0}
    `(
      'toggles console.table output (enableConsoleTable=$enableConsoleTable)',
      ({ enableConsoleTable, expectedCalls }) => {
        logFinalize(report, 'USD', enableConsoleTable);
        expect(consoleTableMock).toHaveBeenCalledTimes(expectedCalls);
      },
    );

    it('prints a fully formatted summary table when enabled', () => {
      logFinalize(report, 'EUR', true);
      expect(consoleTableMock.mock.calls[0][0]).toEqual({
        label: 'PROFIT REPORT',
        startTime: 'iso(1700000000)',
        endtime: 'iso(1700100000)',
        duration: '1h',
        exposure: '55.68% of time exposed',
        startPrice: 'formatted(21000) EUR',
        endPrice: 'formatted(22250) EUR',
        market: '12.34%',
        alpha: '2.56%',
        simulatedYearlyProfit: 'formatted(730) EUR (15.12%)',
        amountOfOrders: 7,
        originalBalance: 'formatted(4800) EUR',
        currentbalance: 'formatted(5050) EUR',
        sharpeRatio: 'ratio(1.5)',
        sortinoRatio: 'ratio(1.1)',
        standardDeviation: 'ratio(0.75)',
        expectedDownside: '9.86%',
      });
    });

    it('emits the final report through the info logger', () => {
      logFinalize(report, 'USD', false);
      expect(infoMock).toHaveBeenCalledWith('performance analyzer', report);
    });
  });

  describe('logTrade', () => {
    const baseTrade: OrderCompleted = {
      side: 'BUY',
      orderId: '98c324a8-e8ad-490b-8baf-96eafc6ddc50',
      date: 1_700_200_000,
      portfolio: { asset: 1.23456789, currency: 4321.12345678 },
      balance: 1000,
      amount: 1,
      fee: 10,
      price: 10,
      effectivePrice: 10,
      type: 'MARKET',
      feePercent: 0.2,
    };

    let consoleTableMock: ReturnType<typeof vi.fn>;
    let numberFormatSpy: ReturnType<typeof vi.spyOn>;
    let numberFormatFormatMock: ReturnType<typeof vi.fn>;
    let consoleTableSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleTableMock = vi.fn();
      numberFormatFormatMock = vi.fn((value: number) => `formatted(${value})`);
      // @ts-expect-error to fix one day
      numberFormatSpy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => ({ format: numberFormatFormatMock }) as unknown as Intl.NumberFormat);
      consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(consoleTableMock);
    });

    afterEach(() => {
      numberFormatSpy.mockRestore();
      consoleTableSpy.mockRestore();
    });

    it.each`
      side      | quantityLabel      | expectedAsset
      ${'BUY'}  | ${'1.23456789'}    | ${'BTC'}
      ${'SELL'} | ${'4321.12345678'} | ${'USD'}
    `('logs a normalized $side trade report', ({ side, quantityLabel, expectedAsset }) => {
      const trade = { ...baseTrade, side, portfolio: { ...baseTrade.portfolio } } as OrderCompleted;
      logTrade(trade, 'USD', 'BTC', false, { startBalance: 1000 });
      expect(debugMock.mock.calls[0]).toEqual([
        'performance analyzer',
        `${side === 'BUY' ? 'Bought' : 'Sold'} ${quantityLabel} ${expectedAsset} at iso(1700200000)`,
      ]);
      expect(consoleTableMock).not.toHaveBeenCalled();
    });

    it('renders a console table with portfolio deltas when enabled', () => {
      logTrade(baseTrade, 'EUR', 'BTC', true, { startBalance: 900, previousBalance: 950 });

      expect(consoleTableMock).toHaveBeenCalledTimes(1);
      expect(consoleTableMock.mock.calls[0][0]).toEqual({
        label: 'TRADE SNAPSHOT',
        timestamp: 'iso(1700200000)',
        side: 'BUY',
        amount: '1 BTC',
        price: 'formatted(10) EUR',
        effectivePrice: 'formatted(10) EUR',
        volume: 'formatted(10) EUR',
        balance: 'formatted(1000) EUR',
        portfolioChange: 'since last trade: +formatted(50) EUR (+5.26%)',
        totalSinceStart: 'since start: +formatted(100) EUR (+11.11%)',
        feePaid: 'formatted(10) EUR (0.2%)',
      });
    });

    it('falls back to the initial balance when no previous trade is available', () => {
      logTrade(baseTrade, 'USD', 'BTC', true, { startBalance: 1000 });
      expect(consoleTableMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          portfolioChange: 'since start: formatted(0) USD (0%)',
          totalSinceStart: 'since start: formatted(0) USD (0%)',
        }),
      );
    });
  });
});
