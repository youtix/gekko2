import { warning } from '@services/logger';
import { calculateSharpeRatio, calculateSortinoRatio } from '@utils/finance/stats.utils';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceStatisticsInput } from './analyzer.types';
import { calculatePerformanceStatistics, isFetchedPortfolio } from './analyzer.utils';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2023 has 365 days: a day is 1/365 of a year in it
const START = Date.UTC(2023, 0, 1);
/** A gain of 1 % over an hour, the returns of which are a gain of 2 % and a loss of 1 %, with an exposure of half an hour */
const INPUT: PerformanceStatisticsInput = {
  periodStartAt: START,
  periodEndAt: START + HOUR,
  startEquity: 1000,
  endEquity: 1010,
  returns: [2, -1],
  marketReturnPct: 0.4,
  exposureMs: HOUR / 2,
  riskFreeReturn: 5,
};
/** The statistics of INPUT over a period of that many milliseconds */
const statisticsOver = (periodMs: number) =>
  calculatePerformanceStatistics({ ...INPUT, periodEndAt: START + periodMs, exposureMs: 0 }, 'portfolio analyzer');

describe('calculatePerformanceStatistics', () => {
  // The return of 1 % and the net profit of 10 are annualized over one horizon, the ratios too: the period, or a day for a shorter one
  describe.each`
    period           | periodMs     | horizon         | horizonYears
    ${'of 0 ms'}     | ${0}         | ${'a day'}      | ${1 / 365}
    ${'of an hour'}  | ${HOUR}      | ${'a day'}      | ${1 / 365}
    ${'of a day'}    | ${DAY}       | ${'the period'} | ${1 / 365}
    ${'of two days'} | ${2 * DAY}   | ${'the period'} | ${2 / 365}
    ${'of a year'}   | ${365 * DAY} | ${'the period'} | ${1}
  `('over a period $period, annualized over $horizon', ({ periodMs, horizonYears }) => {
    it('should annualize the return over that horizon', () => {
      expect(statisticsOver(periodMs).annualizedReturnPct).toBeCloseTo(1 / horizonYears, 6);
    });

    it('should annualize the net profit over that horizon', () => {
      expect(statisticsOver(periodMs).annualizedNetProfit).toBeCloseTo(10 / horizonYears, 6);
    });

    it.each`
      ratio             | calculateRatio
      ${'sharpeRatio'}  | ${calculateSharpeRatio}
      ${'sortinoRatio'} | ${calculateSortinoRatio}
    `('should annualize the $ratio over that horizon', ({ ratio, calculateRatio }) => {
      const expected = calculateRatio({ returns: [2, -1], yearlyProfit: 1 / horizonYears, riskFreeReturn: 5, elapsedYears: horizonYears });
      expect(statisticsOver(periodMs)[ratio as 'sharpeRatio']).toBeCloseTo(expected, 6);
    });
  });

  it.each`
    period           | periodMs   | warnings
    ${'of 0 ms'}     | ${0}       | ${1}
    ${'of an hour'}  | ${HOUR}    | ${1}
    ${'of a day'}    | ${DAY}     | ${0}
    ${'of two days'} | ${2 * DAY} | ${0}
  `('should warn $warnings time(s) that the figures are annualized over a day with a period $period', ({ periodMs, warnings }) => {
    statisticsOver(periodMs);
    expect(warning).toHaveBeenCalledTimes(warnings);
  });

  it('should warn with the tag of the analyzer that a period shorter than a day is annualized over a day', () => {
    calculatePerformanceStatistics(INPUT, 'roundtrip analyzer');
    expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Period shorter than a day'));
  });

  it.each`
    field                  | expected
    ${'periodStartAt'}     | ${START}
    ${'periodEndAt'}       | ${START + HOUR}
    ${'netProfit'}         | ${10}
    ${'totalReturnPct'}    | ${1}
    ${'marketReturnPct'}   | ${0.4}
    ${'alpha'}             | ${0.6}
    ${'exposurePct'}       | ${50}
    ${'downsideDeviation'} | ${Math.SQRT1_2}
  `('should report $field $expected', ({ field, expected }) => {
    expect(calculatePerformanceStatistics(INPUT, 'portfolio analyzer')[field as 'netProfit']).toBeCloseTo(expected, 10);
  });

  it('should report the duration of the period', () => {
    expect(calculatePerformanceStatistics(INPUT, 'portfolio analyzer').formattedDuration).toBe('1 hour');
  });

  it('should report an exposure of 0 over a period of 0 ms', () => {
    expect(statisticsOver(0).exposurePct).toBe(0);
  });

  it.each`
    returns    | volatility | description
    ${[]}      | ${0}       | ${'no return'}
    ${[2]}     | ${0}       | ${'a single return'}
    ${[2, -1]} | ${1.5}     | ${'returns of 2 and -1'}
  `('should report a volatility of $volatility with $description', ({ returns, volatility }) => {
    expect(calculatePerformanceStatistics({ ...INPUT, returns }, 'portfolio analyzer').volatility).toBe(volatility);
  });
});

describe('isFetchedPortfolio', () => {
  it.each`
    portfolio                                                                                       | fetched  | description
    ${new Map()}                                                                                    | ${false} | ${'the empty one the Trader starts with'}
    ${new Map([['USDT', { free: 0, used: 0, total: 0 }]])}                                          | ${true}  | ${'an account that holds nothing'}
    ${new Map([['BTC', { free: 1, used: 0, total: 1 }], ['USDT', { free: 5, used: 0, total: 5 }]])} | ${true}  | ${'an account that holds an asset and the currency'}
  `('should tell that a portfolio was fetched ($fetched) for $description', ({ portfolio, fetched }) => {
    expect(isFetchedPortfolio(portfolio)).toBe(fetched);
  });
});
