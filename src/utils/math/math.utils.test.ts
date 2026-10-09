import { describe, expect, it } from 'vitest';
import { addPrecise, compareWithTolerance, isFiniteNumber, stdev, weightedMean } from './math.utils';

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
  // 1.2345678901234567, its decimal point moved by its 16 decimals, is 12345678901234567, past 2 ** 53, which a double holds as
  // 12345678901234568: added to -0.5 so moved, the sum, back under 2 ** 53, would read back as 0.7345678901234568. addPrecise is then
  // a + b, as for a sum past 2 ** 53. Moved by a binary product, the values came back off from 2 ** 51 already, further than a + b.
  it.each`
    description                                               | a                     | b                     | expected
    ${'0.1 + 0.2, 0.30000000000000004 in binary'}             | ${0.1}                | ${0.2}                | ${0.3}
    ${'1.005 + 0.005, 1.0099999999999998 in binary'}          | ${1.005}              | ${0.005}              | ${1.01}
    ${'2.5 - 2.2, 0.2999999999999998 in binary'}              | ${2.5}                | ${-2.2}               | ${0.3}
    ${'0.3 - 0.1, 0.19999999999999998 in binary'}             | ${0.3}                | ${-0.1}               | ${0.2}
    ${'values the binary sum adds right'}                     | ${123.456}            | ${0.444}              | ${123.9}
    ${'zeros'}                                                | ${0}                  | ${0}                  | ${0}
    ${'negative zeros, a negative zero'}                      | ${-0}                 | ${-0}                 | ${-0}
    ${'a negative value'}                                     | ${-1.1}               | ${2.2}                | ${1.1}
    ${'values written with an exponent'}                      | ${1e-7}               | ${2e-7}               | ${3e-7}
    ${'a sum without decimals'}                               | ${1.234567}           | ${8.765433}           | ${10}
    ${'16 digits, an ulp below through a binary product'}     | ${567095.51811}       | ${57385.8976364135}   | ${624481.4157464135}
    ${'16 digits, an ulp above through a binary product'}     | ${4310369.491577148}  | ${3184194.5648193}    | ${7494564.056396448}
    ${'past 2 ** 53 once moved: a + b, not an ulp above'}     | ${123456.78901234567} | ${1e-8}               | ${123456.78901235567}
    ${'the first past 2 ** 53 once moved, the sum under it'}  | ${1.2345678901234567} | ${-0.5}               | ${0.7345678901234567}
    ${'the second past 2 ** 53 once moved, the sum under it'} | ${-0.5}               | ${1.2345678901234567} | ${0.7345678901234567}
    ${'both under 2 ** 53 once moved, their sum past it'}     | ${583868605058252.8}  | ${478743844670668.7}  | ${1062612449728921.5}
    ${'310 decimals, NaN through a binary product'}           | ${1e-300}             | ${1e-310}             | ${1.0000000001e-300}
    ${'NaN, as a + b'}                                        | ${NaN}                | ${1}                  | ${NaN}
    ${'Infinity, as a + b'}                                   | ${Infinity}           | ${1}                  | ${Infinity}
  `('should return $expected for $a + $b: $description', ({ a, b, expected }) => {
    expect(addPrecise(a, b)).toBe(expected);
  });
});

describe('isFiniteNumber', () => {
  it.each`
    value               | expected
    ${0}                | ${true}
    ${-2.5}             | ${true}
    ${Number.MAX_VALUE} | ${true}
    ${NaN}              | ${false}
    ${Infinity}         | ${false}
    ${-Infinity}        | ${false}
    ${null}             | ${false}
    ${undefined}        | ${false}
    ${'1'}              | ${false}
  `('should tell whether $value is a finite number: $expected', ({ value, expected }) => {
    expect(isFiniteNumber(value)).toBe(expected);
  });
});

describe('compareWithTolerance', () => {
  // 2 ** 30 + 1 lies 9.3e-10 of 2 ** 30 away from it, within the default tolerance of 1e-9, and 2 ** 30 + 2 lies 1.9e-9 away
  it.each`
    description                                                             | a                     | b                     | expected
    ${'equal values'}                                                       | ${30081.93}           | ${30081.93}           | ${0}
    ${'the running-sum SMA of a flat window at 30081.93, 17 ulps above it'} | ${30081.930000000062} | ${30081.93}           | ${0}
    ${'a flat price 17 ulps below its running-sum SMA'}                     | ${30081.93}           | ${30081.930000000062} | ${0}
    ${'hlc3 of a flat candle at 30081.93, one ulp above its close'}         | ${30081.930000000004} | ${30081.93}           | ${0}
    ${'a value within the default tolerance above another'}                 | ${2 ** 30 + 1}        | ${2 ** 30}            | ${0}
    ${'a value beyond the default tolerance above another'}                 | ${2 ** 30 + 2}        | ${2 ** 30}            | ${1}
    ${'a value beyond the default tolerance below another'}                 | ${2 ** 30}            | ${2 ** 30 + 2}        | ${-1}
    ${'a price a tick of 0.01 above another, on 100000'}                    | ${100000.01}          | ${100000}             | ${1}
    ${'a price a tick of 0.01 below another, on 100000'}                    | ${99999.99}           | ${100000}             | ${-1}
    ${'negative values within the tolerance'}                               | ${-(2 ** 30) - 1}     | ${-(2 ** 30)}         | ${0}
    ${'negative values beyond it'}                                          | ${-1}                 | ${-2}                 | ${1}
    ${'0 and -0'}                                                           | ${0}                  | ${-0}                 | ${0}
    ${'a tiny value and 0, never within a tolerance relative to them'}      | ${1e-300}             | ${0}                  | ${1}
    ${'0 and a tiny negative value'}                                        | ${0}                  | ${-1e-300}            | ${1}
    ${'tiny values of opposite signs'}                                      | ${-1e-12}             | ${1e-12}              | ${-1}
    ${'Infinity and itself'}                                                | ${Infinity}           | ${Infinity}           | ${0}
    ${'Infinity and the largest finite value'}                              | ${Infinity}           | ${Number.MAX_VALUE}   | ${1}
    ${'-Infinity and a finite value'}                                       | ${-Infinity}          | ${0}                  | ${-1}
    ${'values whose difference overflows to Infinity'}                      | ${Number.MAX_VALUE}   | ${-Number.MAX_VALUE}  | ${1}
    ${'NaN and a value'}                                                    | ${NaN}                | ${1}                  | ${NaN}
    ${'a value and NaN'}                                                    | ${1}                  | ${NaN}                | ${NaN}
  `('should compare $description as $expected', ({ a, b, expected }) => {
    expect(compareWithTolerance(a, b)).toBe(expected);
  });

  // The tolerance is a share of the larger magnitude: 1 apart is within 25 % of 4, whichever of 3 and 4 comes first, not of 3
  it.each`
    description                                           | a                     | b           | tolerance | expected
    ${'values within 1 %'}                                | ${101}                | ${100}      | ${0.01}   | ${0}
    ${'values beyond 1 %'}                                | ${102}                | ${100}      | ${0.01}   | ${1}
    ${'4 and 3, 25 % of 4 apart'}                         | ${4}                  | ${3}        | ${0.25}   | ${0}
    ${'3 and 4, 25 % of 4 apart'}                         | ${3}                  | ${4}        | ${0.25}   | ${0}
    ${'3 and 2, beyond 25 % of 3'}                        | ${3}                  | ${2}        | ${0.25}   | ${1}
    ${'a running-sum SMA, exactly with a tolerance of 0'} | ${30081.930000000062} | ${30081.93} | ${0}      | ${1}
  `('should compare $description with a tolerance of $tolerance as $expected', ({ a, b, tolerance, expected }) => {
    expect(compareWithTolerance(a, b, tolerance)).toBe(expected);
  });
});
