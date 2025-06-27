import { describe, expect, it } from 'vitest';
import { add, divide, linreg, mean, multiply, percentile, stdev, sum, sumBy, weightedMean } from './math.utils';

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
      expect(m).toBe(expectedM);
      expect(b).toBe(expectedB);
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
  `('returns $expected for values $values and weights $weights', ({ values, weights, expected }) => {
    expect(weightedMean(values, weights)).toBeCloseTo(expected);
  });

  it('throws error when values and weights have different lengths', () => {
    expect(() => weightedMean([1, 2], [1])).toThrow();
  });

  it('throws error when provided with empty arrays', () => {
    expect(() => weightedMean([], [])).toThrow();
  });

  it('throws error when sum of weights is zero', () => {
    expect(() => weightedMean([1, 2, 3], [0, 0, 0])).toThrow();
  });

  it('does not mutate the input arrays', () => {
    const values = [1, 2, 3];
    const weights = [1, 1, 1];
    const valuesCopy = [...values];
    const weightsCopy = [...weights];

    weightedMean(values, weights);

    expect(values).toEqual(valuesCopy);
    expect(weights).toEqual(weightsCopy);
  });
});

describe('multiply', () => {
  it.each`
    a      | b      | expected
    ${2}   | ${3}   | ${6}
    ${2}   | ${0}   | ${0}
    ${-2}  | ${3}   | ${-6}
    ${0.1} | ${0.2} | ${0.02}
  `('returns $expected when multiplying $a and $b', ({ a, b, expected }) => {
    expect(multiply(a, b)).toBeCloseTo(expected);
  });
});

describe('add', () => {
  it.each`
    a      | b      | expected
    ${1}   | ${2}   | ${3}
    ${-1}  | ${2}   | ${1}
    ${1.1} | ${2.2} | ${3.3}
    ${0}   | ${0}   | ${0}
  `('returns $expected when adding $a and $b', ({ a, b, expected }) => {
    expect(add(a, b)).toBeCloseTo(expected);
  });
});

describe('divide', () => {
  it.each`
    a     | b     | expected
    ${6}  | ${3}  | ${2}
    ${1}  | ${2}  | ${0.5}
    ${10} | ${-2} | ${-5}
  `('returns $expected when dividing $a by $b', ({ a, b, expected }) => {
    expect(divide(a, b)).toBeCloseTo(expected);
  });

  it('throws an error when dividing by zero', () => {
    expect(() => divide(1, 0)).toThrow();
  });
});

describe('sum', () => {
  it.each`
    values        | expected
    ${[1, 2, 3]}  | ${6}
    ${[]}         | ${0}
    ${[-1, 1]}    | ${0}
    ${[0.1, 0.2]} | ${0.3}
  `('returns $expected for sum($values)', ({ values, expected }) => {
    expect(sum(values)).toBeCloseTo(expected);
  });
});

describe('sumBy', () => {
  it('sums values using a key accessor', () => {
    const data = [{ value: 1 }, { value: 2 }, { value: 3 }];
    expect(sumBy(data, 'value')).toBe(6);
  });

  it('sums values using a function accessor', () => {
    const data = [{ a: 1 }, { a: 2 }];
    expect(sumBy(data, obj => obj.a)).toBe(3);
  });
});

describe('mean', () => {
  it.each`
    values       | expected
    ${[1, 2, 3]} | ${2}
    ${[0]}       | ${0}
    ${[10, 20]}  | ${15}
    ${[]}        | ${NaN}
    ${null}      | ${NaN}
    ${undefined} | ${NaN}
  `('returns $expected for $values', ({ values, expected }) => {
    expect(mean(values)).toBe(expected);
  });
});
