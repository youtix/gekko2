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

vi.mock('@utils/string/string.utils', () => ({
  formatRatio: formatRatioMock,
}));

let logFinalize: typeof import('./performanceAnalyzer.utils').logFinalize;
let logTrade: typeof import('./performanceAnalyzer.utils').logTrade;

beforeAll(async () => {
  ({ logFinalize, logTrade } = await import('./performanceAnalyzer.utils'));
});

describe('performanceAnalyzer.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toISOStringMock.mockImplementation((value: EpochTimeStamp) => `iso(${value})`);
    roundMock.mockImplementation(
      (value: number, decimals: number, mode?: string) => `rounded(${value},${decimals},${mode ?? 'default'})`,
    );
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
      trades: 7,
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
        exposure: 'rounded(55.678,2,halfEven)% of time exposed',
        startPrice: 'formatted(21000) EUR',
        endPrice: 'formatted(22250) EUR',
        market: 'rounded(12.34,2,down)%',
        alpha: 'rounded(2.56,2,down)%',
        simulatedYearlyProfit: 'formatted(730) EUR (rounded(15.12,2,down)%)',
        amountOfTrades: 7,
        originalBalance: 'formatted(4800) EUR',
        currentbalance: 'formatted(5050) EUR',
        sharpeRatio: 'ratio(1.5)',
        sortinoRatio: 'ratio(1.1)',
        standardDeviation: 'ratio(0.75)',
        expectedDownside: 'rounded(9.87,2,down)%',
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
      requestedAmount: 1,
      cost: 10,
      amount: 1,
      price: 10,
      effectivePrice: 10,
      orderType: 'MARKET',
      feePercent: 0.2,
    };

    it.each`
      side      | amountField   | quantityLabel                         | expectedAsset
      ${'BUY'}  | ${'asset'}    | ${'rounded(1.23456789,8,default)'}    | ${'BTC'}
      ${'SELL'} | ${'currency'} | ${'rounded(4321.12345678,8,default)'} | ${'USD'}
    `('logs a normalized $side trade report', ({ side, amountField, quantityLabel, expectedAsset }) => {
      const trade = { ...baseTrade, side, portfolio: { ...baseTrade.portfolio } } as OrderCompleted;
      logTrade(trade, 'USD', 'BTC');
      expect({
        roundCalls: roundMock.mock.calls,
        message: debugMock.mock.calls[0],
        amountField,
        usedSide: trade.side,
      }).toEqual({
        roundCalls: [[trade.portfolio[amountField as 'asset' | 'currency'], 8]],
        message: [
          'performance analyzer',
          `${side === 'BUY' ? 'Bought' : 'Sold'} ${quantityLabel} ${expectedAsset} at iso(1700200000)`,
        ],
        amountField,
        usedSide: side,
      });
    });
  });
});
