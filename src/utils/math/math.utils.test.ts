import { describe, expect, it } from 'vitest';
import { addPrecise, linreg, percentile, sharpeRatio, sortinoRatio, stdev, weightedMean } from './math.utils';

describe('stdev', () => {
  it.each`
    description                               | input                        | expected
    ${'return NaN when input is undefined'}   | ${undefined}                 | ${NaN}
    ${'return NaN when input is null'}        | ${null}                      | ${NaN}
    ${'return NaN when input is empty array'} | ${[]}                        | ${NaN}
    ${'return zero when only one input'}      | ${[42.4242]}                 | ${0}
    ${'return stdev of input'}                | ${[2, 4, 4, 4, 5, 5, 7, 9]}  | ${2}
    ${'take in account strings'}              | ${[600, 470, 170, 430, 300]} | ${147.32277488562318}
  `('should $description', ({ input, expected }) => {
    expect(stdev(input)).toBe(expected);
  });
});

describe('percentile', () => {
  const scores = [4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10];
  const scores2 = [3, 5, 7, 8, 9, 11, 13, 15];
  const scores3 = [15, 20, 35, 40, 50];
  const scores4 = [100, 200];

  it.each`
    input        | ptile        | expected
    ${undefined} | ${0.25}      | ${NaN}
    ${null}      | ${0.25}      | ${NaN}
    ${[]}        | ${0.25}      | ${NaN}
    ${scores}    | ${undefined} | ${NaN}
    ${scores}    | ${0.5}       | ${7}
    ${scores}    | ${0.25}      | ${5}
    ${scores}    | ${0.85}      | ${9.15}
    ${scores2}   | ${0.25}      | ${6.5}
    ${scores3}   | ${0.4}       | ${29}
    ${scores4}   | ${0.9}       | ${190}
  `('should return $expected when input is $input and percentile $ptile', ({ input, ptile, expected }) => {
    if (Number.isFinite(expected)) expect(percentile(input, ptile)).toBeCloseTo(expected, 2);
    else expect(percentile(input, ptile)).toBeNaN();
  });
});

describe('linreg', () => {
  // Test cases for valid input arrays.
  it.each`
    valuesX            | valuesY             | expectedM | expectedB
    ${[1, 2, 3, 4, 5]} | ${[2, 4, 6, 8, 10]} | ${2}      | ${0}
    ${[1, 2, 3]}       | ${[1, 2, 3]}        | ${1}      | ${0}
    ${[1, 2, 3]}       | ${[2, 2, 2]}        | ${0}      | ${2}
    ${[1, 2, 3, 4, 5]} | ${[1, 3, 2, 5, 4]}  | ${0.8}    | ${0.6}
  `(
    'should calculate regression for valuesX: $valuesX and valuesY: $valuesY',
    ({ valuesX, valuesY, expectedM, expectedB }) => {
      const [m, b] = linreg(valuesX, valuesY);
      // Compare the Big numbers by converting them to string.
      expect(m).toBeCloseTo(expectedM);
      expect(b).toBeCloseTo(expectedB);
    },
  );

  // Test that when the input arrays are empty, the function returns [].
  it('should return [] when given empty arrays', () => {
    expect(linreg([], [])).toEqual([]);
  });

  // Test that the function throws an error if the input arrays are not the same length.
  it('should throw an error when valuesX and valuesY have different lengths', () => {
    expect(() => linreg([1, 2, 3], [1, 2])).toThrow('The parameters valuesX and valuesY need to have same size!');
  });
});

describe('weightedMean', () => {
  it.each`
    values          | weights         | expected
    ${[1, 2, 3]}    | ${[1, 1, 1]}    | ${2}
    ${[1, 2, 3, 4]} | ${[1, 2, 3, 4]} | ${3}
    ${[10, 20]}     | ${[0.5, 1.5]}   | ${17.5}
  `('should return $expected for values $values and weights $weights', ({ values, weights, expected }) => {
    expect(weightedMean(values, weights)).toBeCloseTo(expected);
  });

  it('should throw an error when values and weights have different lengths', () => {
    expect(() => weightedMean([1, 2], [1])).toThrow();
  });

  it('should throw an error when provided with empty arrays', () => {
    expect(() => weightedMean([], [])).toThrow();
  });

  it('should throw an error when sum of weights is zero', () => {
    expect(() => weightedMean([1, 2, 3], [0, 0, 0])).toThrow();
  });

  it('should not mutate the input arrays', () => {
    const values = [1, 2, 3];
    const weights = [1, 1, 1];
    const valuesCopy = [...values];
    const weightsCopy = [...weights];

    weightedMean(values, weights);

    expect(values).toEqual(valuesCopy);
    expect(weights).toEqual(weightsCopy);
  });
});

describe('addPrecise', () => {
  it.each`
    a           | b           | expected
    ${0.1}      | ${0.2}      | ${0.3}
    ${1.005}    | ${0.005}    | ${1.01}
    ${123.456}  | ${0.444}    | ${123.9}
    ${0}        | ${0}        | ${0}
    ${-1.1}     | ${2.2}      | ${1.1}
    ${1e-7}     | ${2e-7}     | ${3e-7}
    ${1.234567} | ${8.765433} | ${10}
  `('returns $expected for $a + $b', ({ a, b, expected }) => {
    expect(addPrecise(a, b)).toBe(expected);
  });
});

describe('sharpeRatio', () => {
  it.each`
    description                                  | returns         | yearlyProfit | riskFreeReturn | elapsedYears | expected
    ${'return 0 for empty returns array'}        | ${[]}           | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 for zero elapsed years'}         | ${[1, 2, 3]}    | ${10}        | ${1}           | ${0}         | ${0}
    ${'return 0 for negative elapsed years'}     | ${[1, 2, 3]}    | ${10}        | ${1}           | ${-1}        | ${0}
    ${'return 0 when all returns are identical'} | ${[5, 5, 5, 5]} | ${10}        | ${1}           | ${1}         | ${0}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, expected }) => {
    expect(sharpeRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears })).toBe(expected);
  });

  it.each`
    description                                           | returns                     | yearlyProfit | riskFreeReturn | elapsedYears | comparison
    ${'calculate positive ratio for profitable strategy'} | ${[2, -1, 3, -0.5, 2.5, 1]} | ${15}        | ${2}           | ${1}         | ${'positive'}
    ${'calculate negative ratio when below risk-free'}    | ${[2, -1, 3, -0.5, 2.5, 1]} | ${0.5}       | ${2}           | ${1}         | ${'negative'}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, comparison }) => {
    const result = sharpeRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears });
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
    const oneYear = sharpeRatio(params);
    const twoYears = sharpeRatio({ ...params, elapsedYears: 2 });
    // Same number of observations over 2 years means fewer observations per year,
    // so annualized volatility is lower, and sharpe should be higher
    expect(twoYears).toBeGreaterThan(oneYear);
  });
});

describe('sortinoRatio', () => {
  it.each`
    description                                      | returns               | yearlyProfit | riskFreeReturn | elapsedYears | expected
    ${'return 0 for empty returns array'}            | ${[]}                 | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 for zero elapsed years'}             | ${[-1, -2, 3]}        | ${10}        | ${1}           | ${0}         | ${0}
    ${'return 0 for negative elapsed years'}         | ${[-1, -2, 3]}        | ${10}        | ${1}           | ${-1}        | ${0}
    ${'return 0 when there are no negative returns'} | ${[1, 2, 3, 4, 5]}    | ${10}        | ${1}           | ${1}         | ${0}
    ${'return 0 when all losses are identical'}      | ${[-2, -2, -2, 5, 5]} | ${10}        | ${1}           | ${1}         | ${0}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, expected }) => {
    expect(sortinoRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears })).toBe(expected);
  });

  it.each`
    description                                             | returns                         | yearlyProfit | riskFreeReturn | elapsedYears | comparison
    ${'calculate positive ratio for profitable strategy'}   | ${[2, -1, 3, -0.5, 2.5, -2, 1]} | ${15}        | ${2}           | ${1}         | ${'positive'}
    ${'calculate negative ratio when below risk-free rate'} | ${[2, -1, 3, -0.5, 2.5, -2, 1]} | ${0.5}       | ${2}           | ${1}         | ${'negative'}
  `('should $description', ({ returns, yearlyProfit, riskFreeReturn, elapsedYears, comparison }) => {
    const result = sortinoRatio({ returns, yearlyProfit, riskFreeReturn, elapsedYears });
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
    const sharpe = sharpeRatio(params);
    const sortino = sortinoRatio(params);
    expect(sortino).toBeGreaterThan(sharpe);
  });
});
