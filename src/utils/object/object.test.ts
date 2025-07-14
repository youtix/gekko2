import { describe, expect, it } from 'vitest';
import { shallowObjectDiff } from './object.utils';

describe('shallowObjectDiff', () => {
  it.each`
    title                                 | a                  | b                  | expected
    ${'primitive inequality'}             | ${{ x: 1 }}        | ${{ x: 2 }}        | ${{ x: 2 }}
    ${'key only in A'}                    | ${{ x: 1 }}        | ${{}}              | ${{ x: 1 }}
    ${'key only in B'}                    | ${{}}              | ${{ y: 'foo' }}    | ${{ y: 'foo' }}
    ${'identical primitive → empty diff'} | ${{ x: 1 }}        | ${{ x: 1 }}        | ${{}}
    ${'NaN vs NaN → empty diff'}          | ${{ n: NaN }}      | ${{ n: NaN }}      | ${{}}
    ${'-0 vs 0'}                          | ${{ z: -0 }}       | ${{ z: 0 }}        | ${{ z: 0 }}
    ${'array refs differ (shallow)'}      | ${{ arr: [1, 2] }} | ${{ arr: [1, 2] }} | ${{ arr: [1, 2] }}
    ${'nested objects: refs differ'}      | ${{ o: { k: 1 } }} | ${{ o: { k: 1 } }} | ${{ o: { k: 1 } }}
  `('$title', ({ a, b, expected }) => {
    expect(shallowObjectDiff(a, b)).toEqual(expected);
  });

  it('produces the same set of diff keys regardless of argument order', () => {
    const a = { p: 1, q: 2 };
    const b = { p: 1, q: 3, r: 4 };

    const keysAB = Object.keys(shallowObjectDiff(a, b)).sort();
    const keysBA = Object.keys(shallowObjectDiff(b, a)).sort();

    expect(keysAB).toEqual(keysBA);
  });

  it('ignores symbol-named properties (not in Object.keys)', () => {
    const s = Symbol('secret');
    const a = { [s]: 123 };
    const b = {};

    expect(shallowObjectDiff(a, b)).toEqual({});
  });

  it.each`
    badA    | badB
    ${null} | ${{}}
    ${{}}   | ${undefined}
    ${null} | ${undefined}
  `('throws TypeError on null / undefined input', ({ badA, badB }) => {
    expect(() => shallowObjectDiff(badA, badB)).toThrow(TypeError);
  });
});
