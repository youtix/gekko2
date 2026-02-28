import { describe, expect, it } from 'vitest';
import { addPrecise, linreg, percentile, stdev, weightedMean } from './math.utils';

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
  `('should calculate regression for valuesX: $valuesX and valuesY: $valuesY', ({ valuesX, valuesY, expectedM, expectedB }) => {
    const [m, b] = linreg(valuesX, valuesY);
    // Compare the Big numbers by converting them to string.
    expect(m).toBeCloseTo(expectedM);
    expect(b).toBeCloseTo(expectedB);
  });

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

  it('should return NaN when values and weights have different lengths', () => {
    expect(weightedMean([1, 2], [1])).toBeNaN();
  });

  it('should return NaN when provided with empty arrays', () => {
    expect(weightedMean([], [])).toBeNaN();
  });

  it('should return NaN when sum of weights is zero', () => {
    expect(weightedMean([1, 2, 3], [0, 0, 0])).toBeNaN();
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
