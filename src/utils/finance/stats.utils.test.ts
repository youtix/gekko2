import { describe, expect, it } from 'vitest';
import {
  calculateAlpha,
  calculateAnnualizedReturnPct,
  calculateDownsideDeviation,
  calculateElapsedYears,
  calculateExposurePct,
  calculateLongestDrawdownDuration,
  calculateMarketReturnPct,
  calculateMaxDrawdown,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateTotalReturnPct,
  calculateWinRate,
  extractTopMAEs,
} from './stats.utils';

// Pre-computed timestamps for testing (using UTC dates to avoid timezone issues)
const JAN_01_2023 = Date.UTC(2023, 0, 1);
const JUL_02_2023 = Date.UTC(2023, 6, 2);
const JAN_01_2024 = Date.UTC(2024, 0, 1);
const JUL_01_2024 = Date.UTC(2024, 6, 1);
const JAN_01_2025 = Date.UTC(2025, 0, 1);
const JUL_01_2025 = Date.UTC(2025, 6, 1);

describe('calculateElapsedYears', () => {
  it.each`
    description               | startDate      | endDate        | expected
    ${'same day returns 0'}   | ${JAN_01_2024} | ${JAN_01_2024} | ${0}
    ${'exactly 1 year'}       | ${JAN_01_2024} | ${JAN_01_2025} | ${1}
    ${'exactly 2 years'}      | ${JAN_01_2023} | ${JAN_01_2025} | ${2}
    ${'half year (non-leap)'} | ${JAN_01_2023} | ${JUL_02_2023} | ${0.5}
    ${'half year (leap)'}     | ${JAN_01_2024} | ${JUL_01_2024} | ${0.5}
    ${'1.5 years'}            | ${JAN_01_2024} | ${JUL_01_2025} | ${1.5}
  `('should return $expected when $description', ({ startDate, endDate, expected }) => {
    expect(calculateElapsedYears(startDate, endDate)).toBeCloseTo(expected, 1);
  });

  it('should throw error when endDate is before startDate', () => {
    expect(() => calculateElapsedYears(JAN_01_2025, JAN_01_2024)).toThrow('endDate must be greater than or equal to startDate');
  });
});

describe('calculateTotalReturnPct', () => {
  it.each`
    description             | currentEquity | startEquity | expected
    ${'100% gain'}          | ${2000}       | ${1000}     | ${100}
    ${'50% gain'}           | ${1500}       | ${1000}     | ${50}
    ${'no change'}          | ${1000}       | ${1000}     | ${0}
    ${'25% loss'}           | ${750}        | ${1000}     | ${-25}
    ${'50% loss'}           | ${500}        | ${1000}     | ${-50}
    ${'total loss'}         | ${0}          | ${1000}     | ${-100}
    ${'300% gain'}          | ${4000}       | ${1000}     | ${300}
    ${'small start equity'} | ${0.002}      | ${0.001}    | ${100}
  `('should return $expected for $description', ({ currentEquity, startEquity, expected }) => {
    expect(calculateTotalReturnPct(currentEquity, startEquity)).toBeCloseTo(expected, 6);
  });

  it('should throw error when startEquity is zero', () => {
    expect(() => calculateTotalReturnPct(1000, 0)).toThrow('startEquity must be greater than zero');
  });

  it('should throw error when startEquity is negative', () => {
    expect(() => calculateTotalReturnPct(1000, -100)).toThrow('startEquity must be greater than zero');
  });
});

describe('calculateAnnualizedReturnPct', () => {
  it.each`
    description            | totalReturnPct | elapsedYears | expected
    ${'1 year period'}     | ${50}          | ${1}         | ${50}
    ${'2 year period'}     | ${100}         | ${2}         | ${50}
    ${'half year period'}  | ${25}          | ${0.5}       | ${50}
    ${'negative return'}   | ${-30}         | ${2}         | ${-15}
    ${'very short period'} | ${10}          | ${0.1}       | ${100}
    ${'long period'}       | ${100}         | ${10}        | ${10}
  `('should return $expected for $description', ({ totalReturnPct, elapsedYears, expected }) => {
    expect(calculateAnnualizedReturnPct(totalReturnPct, elapsedYears)).toBeCloseTo(expected, 6);
  });

  it('should throw error when elapsedYears is zero', () => {
    expect(() => calculateAnnualizedReturnPct(50, 0)).toThrow('elapsedYears must be greater than zero');
  });

  it('should throw error when elapsedYears is negative', () => {
    expect(() => calculateAnnualizedReturnPct(50, -1)).toThrow('elapsedYears must be greater than zero');
  });
});

describe('calculateMarketReturnPct', () => {
  it.each`
    description       | endPrice | startPrice | expected
    ${'100% gain'}    | ${200}   | ${100}     | ${100}
    ${'50% gain'}     | ${150}   | ${100}     | ${50}
    ${'no change'}    | ${100}   | ${100}     | ${0}
    ${'50% loss'}     | ${50}    | ${100}     | ${-50}
    ${'total loss'}   | ${0}     | ${100}     | ${-100}
    ${'small prices'} | ${0.002} | ${0.001}   | ${100}
    ${'large prices'} | ${60000} | ${30000}   | ${100}
  `('should return $expected for $description', ({ endPrice, startPrice, expected }) => {
    expect(calculateMarketReturnPct(endPrice, startPrice)).toBeCloseTo(expected, 6);
  });

  it('should throw error when startPrice is zero', () => {
    expect(() => calculateMarketReturnPct(100, 0)).toThrow('startPrice must be greater than zero');
  });

  it('should throw error when startPrice is negative', () => {
    expect(() => calculateMarketReturnPct(100, -50)).toThrow('startPrice must be greater than zero');
  });
});

describe('calculateAlpha', () => {
  it.each`
    description           | totalReturnPct | marketReturnPct | expected
    ${'positive alpha'}   | ${50}          | ${30}           | ${20}
    ${'negative alpha'}   | ${20}          | ${50}           | ${-30}
    ${'zero alpha'}       | ${50}          | ${50}           | ${0}
    ${'large alpha'}      | ${100}         | ${-20}          | ${120}
    ${'both negative'}    | ${-10}         | ${-30}          | ${20}
    ${'strategy at loss'} | ${-20}         | ${10}           | ${-30}
  `('should return $expected for $description', ({ totalReturnPct, marketReturnPct, expected }) => {
    expect(calculateAlpha(totalReturnPct, marketReturnPct)).toBe(expected);
  });
});

describe('calculateExposurePct', () => {
  it.each`
    description           | exposureMs  | totalMs     | expected
    ${'100% exposure'}    | ${86400000} | ${86400000} | ${100}
    ${'50% exposure'}     | ${43200000} | ${86400000} | ${50}
    ${'0% exposure'}      | ${0}        | ${86400000} | ${0}
    ${'25% exposure'}     | ${21600000} | ${86400000} | ${25}
    ${'minimal exposure'} | ${1}        | ${1000000}  | ${0.0001}
  `('should return $expected for $description', ({ exposureMs, totalMs, expected }) => {
    expect(calculateExposurePct(exposureMs, totalMs)).toBeCloseTo(expected, 6);
  });

  it('should throw error when totalMs is zero', () => {
    expect(() => calculateExposurePct(1000, 0)).toThrow('totalMs must be greater than zero');
  });

  it('should throw error when totalMs is negative', () => {
    expect(() => calculateExposurePct(1000, -1000)).toThrow('totalMs must be greater than zero');
  });
});

describe('calculateWinRate', () => {
  it.each`
    description       | winningTrades | totalTrades | expected
    ${'all wins'}     | ${10}         | ${10}       | ${100}
    ${'all losses'}   | ${0}          | ${10}       | ${0}
    ${'50% win rate'} | ${5}          | ${10}       | ${50}
    ${'75% win rate'} | ${75}         | ${100}      | ${75}
    ${'33.33% rate'}  | ${1}          | ${3}        | ${33.333333}
    ${'single win'}   | ${1}          | ${1}        | ${100}
    ${'single loss'}  | ${0}          | ${1}        | ${0}
  `('should return $expected for $description', ({ winningTrades, totalTrades, expected }) => {
    expect(calculateWinRate(winningTrades, totalTrades)).toBeCloseTo(expected, 4);
  });

  it('should return null when no trades', () => {
    expect(calculateWinRate(0, 0)).toBeNull();
  });

  it('should return null when totalTrades is negative', () => {
    expect(calculateWinRate(5, -1)).toBeNull();
  });
});

describe('calculateDownsideDeviation', () => {
  it('should return 0 for empty array', () => {
    expect(calculateDownsideDeviation([])).toBe(0);
  });

  it('should return 0 when all profits are positive', () => {
    expect(calculateDownsideDeviation([10, 20, 30, 5])).toBe(0);
  });

  it('should return 0 when all profits are zero', () => {
    expect(calculateDownsideDeviation([0, 0, 0])).toBe(0);
  });

  it('should calculate correctly for all negative profits', () => {
    // All losses: [-10, -20, -30]
    // Squared: [100, 400, 900]
    // Sum: 1400, divided by 3 = 466.67, sqrt = 21.60
    const profits = [-10, -20, -30];
    expect(calculateDownsideDeviation(profits)).toBeCloseTo(21.602, 2);
  });

  it('should calculate correctly for mixed profits', () => {
    // Losses only: [-10, -5]
    // Squared: [100, 25]
    // Sum: 125, divided by 4 (total count) = 31.25, sqrt = 5.59
    const profits = [10, -10, 15, -5];
    expect(calculateDownsideDeviation(profits)).toBeCloseTo(5.59, 2);
  });

  it('should handle single negative profit', () => {
    // Squared: 25, divided by 1 = 25, sqrt = 5
    expect(calculateDownsideDeviation([-5])).toBe(5);
  });

  it('should handle single positive profit', () => {
    expect(calculateDownsideDeviation([5])).toBe(0);
  });
});

describe('extractTopMAEs', () => {
  it('should return empty array for empty input', () => {
    expect(extractTopMAEs([])).toEqual([]);
  });

  it('should return all MAEs when fewer than limit', () => {
    const maes = [5, 10, 3];
    expect(extractTopMAEs(maes)).toEqual([10, 5, 3]);
  });

  it('should return top 10 MAEs by default (sorted descending)', () => {
    const maes = [1, 12, 5, 8, 15, 3, 9, 2, 11, 7, 4, 6, 14, 13, 10];
    expect(extractTopMAEs(maes)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  });

  it('should respect custom limit', () => {
    const maes = [10, 20, 5, 15, 8];
    expect(extractTopMAEs(maes, 3)).toEqual([20, 15, 10]);
  });

  it('should filter out negative values', () => {
    const maes = [10, -5, 20, -10, 15];
    expect(extractTopMAEs(maes)).toEqual([20, 15, 10]);
  });

  it('should filter out NaN values', () => {
    const maes = [10, NaN, 20, NaN, 15];
    expect(extractTopMAEs(maes)).toEqual([20, 15, 10]);
  });

  it('should filter out Infinity values', () => {
    const maes = [10, Infinity, 20, -Infinity, 15];
    expect(extractTopMAEs(maes)).toEqual([20, 15, 10]);
  });

  it('should include zero values', () => {
    const maes = [5, 0, 10, 0];
    expect(extractTopMAEs(maes)).toEqual([10, 5, 0, 0]);
  });

  it('should not mutate the input array', () => {
    const maes = [5, 10, 3];
    const copy = [...maes];
    extractTopMAEs(maes);
    expect(maes).toEqual(copy);
  });
});

describe('calculateSharpeRatio', () => {
  it.each`
    description                                  | returns         | yearlyProfit | riskFreeReturn | elapsedYears | expected
    ${'return 0 for empty returns array'}        | ${[]}           | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 for zero elapsed years'}         | ${[1, 2, 3]}    | ${10}        | ${1}           | ${0}         | ${0}
    ${'return 0 for negative elapsed years'}     | ${[1, 2, 3]}    | ${10}        | ${1}           | ${-1}        | ${0}
    ${'return 0 when all returns are identical'} | ${[5, 5, 5, 5]} | ${10}        | ${1}           | ${1}         | ${0}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, expected }) => {
    expect(calculateSharpeRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears })).toBe(expected);
  });

  it.each`
    description                                           | returns                     | yearlyProfit | riskFreeReturn | elapsedYears | comparison
    ${'calculate positive ratio for profitable strategy'} | ${[2, -1, 3, -0.5, 2.5, 1]} | ${15}        | ${2}           | ${1}         | ${'positive'}
    ${'calculate negative ratio when below risk-free'}    | ${[2, -1, 3, -0.5, 2.5, 1]} | ${0.5}       | ${2}           | ${1}         | ${'negative'}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, comparison }) => {
    const result = calculateSharpeRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears });
    if (comparison === 'positive') expect(result).toBeGreaterThan(0);
    else expect(result).toBeLessThan(0);
  });

  it('should scale correctly with elapsed years', () => {
    const params = {
      returns: [2, -1, 3, -0.5, 2.5, 1, 0.5, -0.3, 1.5, 2, -1, 0.8],
      yearlyProfit: 10,
      riskFreeReturn: 1,
      elapsedYears: 1,
    };
    const oneYear = calculateSharpeRatio(params);
    const twoYears = calculateSharpeRatio({ ...params, elapsedYears: 2 });
    // Same number of observations over 2 years means fewer observations per year,
    // so annualized volatility is lower, and sharpe should be higher
    expect(twoYears).toBeGreaterThan(oneYear);
  });
});

describe('calculateSortinoRatio', () => {
  it.each`
    description                                      | returns               | yearlyProfit | riskFreeReturn | elapsedYears | expected
    ${'return 0 for empty returns array'}            | ${[]}                 | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 for zero elapsed years'}             | ${[-1, -2, 3]}        | ${10}        | ${1}           | ${0}         | ${0}
    ${'return 0 for negative elapsed years'}         | ${[-1, -2, 3]}        | ${10}        | ${1}           | ${-1}        | ${0}
    ${'return 0 when there are no negative returns'} | ${[1, 2, 3, 4, 5]}    | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 when all losses are identical'}      | ${[-2, -2, -2, 5, 5]} | ${10}        | ${1}           | ${1}         | ${0}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, expected }) => {
    expect(calculateSortinoRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears })).toBe(expected);
  });

  it.each`
    description                                             | returns                         | yearlyProfit | riskFreeReturn | elapsedYears | comparison
    ${'calculate positive ratio for profitable strategy'}   | ${[2, -1, 3, -0.5, 2.5, -2, 1]} | ${15}        | ${2}           | ${1}         | ${'positive'}
    ${'calculate negative ratio when below risk-free rate'} | ${[2, -1, 3, -0.5, 2.5, -2, 1]} | ${0.5}       | ${2}           | ${1}         | ${'negative'}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, comparison }) => {
    const result = calculateSortinoRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears });
    if (comparison === 'positive') expect(result).toBeGreaterThan(0);
    else expect(result).toBeLessThan(0);
  });

  it('should be higher than sharpe ratio when there are more gains than losses', () => {
    // When there are more positive returns, downside deviation is typically lower
    // than overall standard deviation, leading to higher Sortino vs Sharpe
    const params = {
      returns: [3, 4, 5, -1, 2, 3, -0.5, 4, 5, 2],
      yearlyProfit: 20,
      riskFreeReturn: 2,
      elapsedYears: 1,
    };
    const sharpe = calculateSharpeRatio(params);
    const sortino = calculateSortinoRatio(params);
    expect(sortino).toBeGreaterThan(sharpe);
  });
});

describe('calculateMaxDrawdown', () => {
  it.each`
    description                                      | balances                   | initialBalance | expected
    ${'return 0 for empty balances array'}           | ${[]}                      | ${1000}        | ${0}
    ${'return 0 when initialBalance is 0'}           | ${[100, 200]}              | ${0}           | ${0}
    ${'return 0 when initialBalance is negative'}    | ${[100, 200]}              | ${-100}        | ${0}
    ${'return 0 when balances only increase'}        | ${[1100, 1200, 1300]}      | ${1000}        | ${0}
    ${'return 0 when balances stay constant'}        | ${[1000, 1000, 1000]}      | ${1000}        | ${0}
    ${'calculate drawdown from initial balance'}     | ${[900]}                   | ${1000}        | ${10}
    ${'calculate drawdown from new peak'}            | ${[1100, 990]}             | ${1000}        | ${10}
    ${'return max drawdown among multiple declines'} | ${[1100, 1000, 1200, 900]} | ${1000}        | ${25}
    ${'handle 100% drawdown'}                        | ${[1000, 0]}               | ${1000}        | ${100}
    ${'handle small fractional changes'}             | ${[100.5, 100.0, 100.2]}   | ${100}         | ${0.4975124378109453}
  `('should $description', ({ balances, initialBalance, expected }) => {
    const result = calculateMaxDrawdown(balances, initialBalance);
    if (expected === 0) {
      expect(result).toBe(0);
    } else {
      expect(result).toBeCloseTo(expected, 5);
    }
  });

  it('should track peak correctly through multiple ups and downs', () => {
    // Peak at 1500, then drop to 1000, that's 33.33% drawdown
    const balances = [1000, 1200, 1500, 1200, 1000, 1300];
    const result = calculateMaxDrawdown(balances, 1000);
    expect(result).toBeCloseTo(33.333333, 4);
  });

  it('should not mutate input array', () => {
    const balances = [1100, 1000, 1200];
    const copy = [...balances];
    calculateMaxDrawdown(balances, 1000);
    expect(balances).toEqual(copy);
  });
});

describe('calculateLongestDrawdownDuration', () => {
  it.each`
    description                                     | samples                                                                                                                                                                      | initialBalance | expected
    ${'return 0 for empty samples'}                 | ${[]}                                                                                                                                                                        | ${1000}        | ${0}
    ${'return 0 when initialBalance is 0'}          | ${[{ date: 1000, totalValue: 900 }]}                                                                                                                                         | ${0}           | ${0}
    ${'return 0 when initialBalance is negative'}   | ${[{ date: 1000, totalValue: 900 }]}                                                                                                                                         | ${-100}        | ${0}
    ${'return 0 if balance never drops below peak'} | ${[{ date: 1000, totalValue: 1000 }, { date: 2000, totalValue: 1100 }]}                                                                                                      | ${1000}        | ${0}
    ${'calculate duration of single drawdown'}      | ${[{ date: 1000, totalValue: 1000 }, { date: 2000, totalValue: 900 }, { date: 3000, totalValue: 1000 }]}                                                                     | ${1000}        | ${2000}
    ${'find longest among multiple drawdowns'}      | ${[{ date: 1000, totalValue: 1000 }, { date: 2000, totalValue: 900 }, { date: 3000, totalValue: 1000 }, { date: 4000, totalValue: 800 }, { date: 10000, totalValue: 1000 }]} | ${1000}        | ${7000}
    ${'handle ongoing drawdown at end'}             | ${[{ date: 1000, totalValue: 1000 }, { date: 2000, totalValue: 900 }]}                                                                                                       | ${1000}        | ${1000}
  `('should $description', ({ samples, initialBalance, expected }) => {
    expect(calculateLongestDrawdownDuration(samples, initialBalance)).toBe(expected);
  });

  it('should track recovery to exact peak value', () => {
    // Drop from 1000 to 800, then recover to exactly 1000 at date 5000
    const samples = [
      { date: 1000, totalValue: 1000 },
      { date: 2000, totalValue: 800 },
      { date: 3000, totalValue: 900 },
      { date: 4000, totalValue: 950 },
      { date: 5000, totalValue: 1000 },
    ];
    expect(calculateLongestDrawdownDuration(samples, 1000)).toBe(4000);
  });

  it('should not mutate input array', () => {
    const samples = [
      { date: 1000, totalValue: 1000 },
      { date: 2000, totalValue: 900 },
    ];
    const copy = JSON.parse(JSON.stringify(samples));
    calculateLongestDrawdownDuration(samples, 1000);
    expect(samples).toEqual(copy);
  });
});
