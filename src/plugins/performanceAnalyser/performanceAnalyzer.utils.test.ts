import { OrderCompletedEvent } from '@models/event.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Report } from './performanceAnalyzer.types';
import { logFinalize, logTrade } from './performanceAnalyzer.utils';

const {
  infoMock,
  debugMock,
  toISOStringMock,
  roundMock,
  formatRatioMock,
  formatSignedAmountMock,
  formatSignedPercentMock,
} = vi.hoisted(() => ({
  infoMock: vi.fn(),
  debugMock: vi.fn(),
  toISOStringMock: vi.fn(),
  roundMock: vi.fn(),
  formatRatioMock: vi.fn(),
  formatSignedAmountMock: vi.fn(),
  formatSignedPercentMock: vi.fn(),
}));

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
  formatSignedAmount: formatSignedAmountMock,
  formatSignedPercent: formatSignedPercentMock,
}));

describe('performanceAnalyzer.utils', () => {
  beforeEach(() => {
    // Reset recurring mocks to default simple behaviors for clean state
    toISOStringMock.mockImplementation((value: EpochTimeStamp) => `iso(${value})`);

    // Simple mock for round to predictable strings or values if needed
    // The original test had complex logic for round, let's simplify or keep it if crucial.
    // The original logic actually reimplemented rounding. Let's return strings to verify calls or simple pass-through.
    // Ideally we trust the utility, so we just want to see it was called.
    // However, the function output is used in strings.
    // Let's stick to the original "smart" mock if it validates logic, or simplify to "rounded(val)"
    // The original mock logic was actually testing the utility behavior which is not this test's responsibility.
    // But since the output is embedded in strings, having distinct values helps.
    // Let's use a simpler mock that produces unique strings.
    roundMock.mockImplementation(val => `round(${val})`);

    formatRatioMock.mockImplementation((ratio: number) => `ratio(${ratio})`);
    formatSignedAmountMock.mockImplementation((val: number) => `signed(${val})`);
    formatSignedPercentMock.mockImplementation((val: number) => `percent(${val})`);
  });

  describe('logFinalize', () => {
    const report: Report = {
      startTime: 1000,
      endTime: 2000,
      duration: '1h',
      market: 10,
      balance: 1100,
      profit: 100,
      relativeProfit: 10,
      yearlyProfit: 1200,
      relativeYearlyProfit: 120,
      startPrice: 100,
      endPrice: 110,
      orders: 5,
      startBalance: 1000,
      exposure: 0.5,
      sharpe: 1.2,
      sortino: 1.3,
      standardDeviation: 0.1,
      maxDrawdown: 0.2,
      alpha: 0.05,
    };

    let consoleTableMock: ReturnType<typeof vi.fn>;
    let numberFormatSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleTableMock = vi.fn();
      const consoleSpy = vi.spyOn(console, 'table').mockImplementation(consoleTableMock as any);

      numberFormatSpy = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function () {
        return {
          format: (val: number) => `fmt(${val})`,
        } as any;
      });

      return () => {
        consoleSpy.mockRestore();
        numberFormatSpy.mockRestore();
      };
    });

    it.each`
      enableConsoleTable | expectedTableCalls
      ${true}            | ${1}
      ${false}           | ${0}
    `(
      'should call console.table $expectedTableCalls times when enableConsoleTable is $enableConsoleTable',
      ({ enableConsoleTable, expectedTableCalls }) => {
        logFinalize(report, 'USD', enableConsoleTable);
        expect(consoleTableMock).toHaveBeenCalledTimes(expectedTableCalls);
      },
    );

    it('should log correct data table when enabled', () => {
      logFinalize(report, 'USD', true);

      expect(consoleTableMock).toHaveBeenCalledWith({
        label: 'PROFIT REPORT',
        startTime: 'iso(1000)',
        endtime: 'iso(2000)',
        duration: '1h',
        exposure: 'round(0.5)% of time exposed',
        startPrice: 'fmt(100) USD',
        endPrice: 'fmt(110) USD',
        market: 'round(10)%',
        alpha: 'round(0.05)%',
        simulatedYearlyProfit: 'fmt(1200) USD (round(120)%)',
        amountOfOrders: 5,
        originalBalance: 'fmt(1000) USD',
        currentbalance: 'fmt(1100) USD',
        sharpeRatio: 'ratio(1.2)',
        sortinoRatio: 'ratio(1.3)',
        standardDeviation: 'ratio(0.1)',
        maxDrawdown: 'round(0.2)%',
      });
    });

    it('should always call info logger with report', () => {
      logFinalize(report, 'USD', false);
      expect(infoMock).toHaveBeenCalledWith('performance analyzer', report);
    });
  });

  describe('logTrade', () => {
    const baseOrder: OrderCompletedEvent['order'] = {
      id: '98c324a8-e8ad-490b-8baf-96eafc6ddc50',
      side: 'BUY',
      type: 'MARKET',
      amount: 1,
      fee: 0.1,
      price: 100,
      effectivePrice: 100,
      feePercent: 0.1,
      orderCreationDate: 1000,
      orderExecutionDate: 1000,
    };

    const baseExchange: OrderCompletedEvent['exchange'] = {
      portfolio: {
        asset: { free: 10, used: 0, total: 10 },
        currency: { free: 1000, used: 0, total: 1000 },
      },
      balance: { free: 2000, used: 0, total: 2000 },
      price: 100,
    };

    let consoleTableMock: ReturnType<typeof vi.fn>;
    let numberFormatSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleTableMock = vi.fn();
      const consoleSpy = vi.spyOn(console, 'table').mockImplementation(consoleTableMock as any);

      numberFormatSpy = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function () {
        return {
          format: (val: number) => `fmt(${val})`,
        } as any;
      });

      return () => {
        consoleSpy.mockRestore();
        numberFormatSpy.mockRestore();
      };
    });

    it.each`
      side      | expectedAction | expectedAmount
      ${'BUY'}  | ${'Bought'}    | ${'round(10)'}
      ${'SELL'} | ${'Sold'}      | ${'round(1000)'}
    `('should log debug message for $side order', ({ side, expectedAction, expectedAmount }) => {
      const order = { ...baseOrder, side } as OrderCompletedEvent['order'];
      logTrade(order, baseExchange, 'USD', 'BTC', false);

      expect(debugMock).toHaveBeenCalledWith(
        'performance analyzer',
        expect.stringContaining(`${expectedAction} ${expectedAmount}`),
      );
    });

    it.each`
      baselineBalance | currentBalance | expectedChangeLabel
      ${1000}         | ${1100}        | ${'signed(100)'}
      ${undefined}    | ${1100}        | ${'since start: n/a'}
      ${NaN}          | ${1100}        | ${'since start: n/a'}
    `(
      'should handle portfolio change calculation for baseline $baselineBalance',
      ({ baselineBalance, currentBalance, expectedChangeLabel }) => {
        // For this test we focus on 'since start' which uses startBalance
        // Logic: const baselineForChange = balances.previousBalance ?? balances.startBalance;
        // 'since start' uses balances.startBalance

        const balances = { startBalance: baselineBalance };
        const exchange = {
          ...baseExchange,
          balance: { free: currentBalance, used: 0, total: currentBalance },
        };

        logTrade(baseOrder, exchange, 'USD', 'BTC', true, balances);

        // If valid, we expect "since start: signed(...) (percent(...))"
        // If invalid, "since start: n/a"

        const tableCall = consoleTableMock.mock.calls[0][0];
        if (typeof baselineBalance === 'number' && !isNaN(baselineBalance)) {
          expect(tableCall.totalSinceStart).toContain(`since start: ${expectedChangeLabel}`);
        } else {
          expect(tableCall.totalSinceStart).toBe(expectedChangeLabel);
        }
      },
    );

    it.each`
      prevBalance  | startBalance | expectedLabel
      ${1500}      | ${1000}      | ${'since last trade'}
      ${undefined} | ${1000}      | ${'since start'}
    `('should choose correct baseline label: $expectedLabel', ({ prevBalance, startBalance, expectedLabel }) => {
      const balances = { previousBalance: prevBalance, startBalance };
      logTrade(baseOrder, baseExchange, 'USD', 'BTC', true, balances);

      expect(consoleTableMock.mock.calls[0][0].portfolioChange).toContain(expectedLabel);
    });

    it('should handle infinite change (division by zero protection implicit in logic?? No, explicit check)', () => {
      // In utils: if (!Number.isFinite(absoluteChange)) return `${label}: n/a`;
      // absoluteChange = current - baseline. If baseline is valid number, this is usually finite unless values are Infinity.

      // Let's test the baselineBalance === 0 case -> percent is 'n/a'
      const balances = { startBalance: 0 };
      const exchange = {
        ...baseExchange,
        balance: { free: 100, used: 0, total: 100 },
      };

      logTrade(baseOrder, exchange, 'USD', 'BTC', true, balances);

      const tableCall = consoleTableMock.mock.calls[0][0];
      // absoluteChange = 100 - 0 = 100 (finite)
      // percentChange = 0 === 0 ? 'n/a'
      expect(tableCall.totalSinceStart).toContain('(n/a)');
    });

    it('should handle fee format with and without percent', () => {
      // With percent
      logTrade({ ...baseOrder, feePercent: 0.5 }, baseExchange, 'USD', 'BTC', true);
      expect(consoleTableMock.mock.calls[0][0].feePaid).toContain('(round(0.5)%)');

      // Without percent (undefined)
      consoleTableMock.mockClear();
      logTrade({ ...baseOrder, feePercent: undefined }, baseExchange, 'USD', 'BTC', true);
      expect(consoleTableMock.mock.calls[0][0].feePaid).not.toContain('%');
    });

    it('should default balances to empty object if not provided', () => {
      logTrade(baseOrder, baseExchange, 'USD', 'BTC', true);
      // Logic: balances = {} -> previousBalance undefined, startBalance undefined
      // describesPortfolioChange(..., ..., undefined, ...) -> "n/a"
      expect(consoleTableMock.mock.calls[0][0].portfolioChange).toBe('since start: n/a');
    });

    it('should handle infinite absolute change', () => {
      // if (!Number.isFinite(absoluteChange))
      const exchange = {
        ...baseExchange,
        balance: { free: Infinity, used: 0, total: Infinity },
      };
      const balances = { startBalance: 1000 };

      logTrade(baseOrder, exchange, 'USD', 'BTC', true, balances);
      expect(consoleTableMock.mock.calls[0][0].totalSinceStart).toBe('since start: n/a');
    });
  });
});
