import { afterEach, describe, expect, it, vi } from 'vitest';
import * as utils from './learning.utils';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('learning.utils', () => {
  describe('zeros', () => {
    it.each`
      n             | length | ctor
      ${undefined}  | ${0}   | ${'Array'}
      ${Number.NaN} | ${0}   | ${'Array'}
      ${3}          | ${3}   | ${'Float64Array'}
    `('zeros($n) shape and type', ({ n, length, ctor }) => {
      const arr = utils.zeros(n as number | undefined);
      const ok = Array.isArray(arr)
        ? arr.length === length && arr.constructor.name === ctor
        : (arr as Float64Array).length === length && (arr as Float64Array).constructor.name === ctor;
      expect(ok).toBe(true);
    });
  });

  describe('arrContains/arrUnique', () => {
    it.each`
      arr                     | search | contains | unique
      ${[1, 2, 2, 3, 1]}      | ${2}   | ${true}  | ${[1, 2, 3]}
      ${['a', 'b', 'a', 'c']} | ${'z'} | ${false} | ${['a', 'b', 'c']}
    `('array utils on $arr', ({ arr, search, contains, unique }) => {
      const result =
        utils.arrContains(arr as unknown[], search) === contains &&
        JSON.stringify(utils.arrUnique(arr as unknown[])) === JSON.stringify(unique);
      expect(result).toBe(true);
    });
  });

  describe('maxmin', () => {
    it.each`
      arr                               | expected
      ${[1, 3, 2]}                      | ${{ maxi: 1, maxv: 3, mini: 0, minv: 1, dv: 2 }}
      ${[3, 3, 3]}                      | ${{ maxi: 0, maxv: 3, mini: 0, minv: 3, dv: 0 }}
      ${[-5, -1, -3, 2]}                | ${{ maxi: 3, maxv: 2, mini: 0, minv: -5, dv: 7 }}
      ${new Float64Array([4, 2, 9, 1])} | ${{ maxi: 2, maxv: 9, mini: 3, minv: 1, dv: 8 }}
    `('computes extremes for $arr', ({ arr, expected }) => {
      const mm = utils.maxmin(arr as number[] | Float64Array);
      expect(mm).toEqual(expected);
    });
  });

  describe('randperm', () => {
    it.each`
      n
      ${1}
      ${2}
      ${10}
    `('returns a valid permutation for n=$n', ({ n }) => {
      const p = utils.randperm(n as number);
      const ok = p.length === n && new Set(p).size === n && Math.min(...p) === 0 && Math.max(...p) === n - 1;
      expect(ok).toBe(true);
    });
  });

  describe('randf', () => {
    it.each`
      rnd       | a    | b    | expected
      ${0}      | ${2} | ${6} | ${2}
      ${0.25}   | ${2} | ${6} | ${3}
      ${0.9999} | ${2} | ${6} | ${5.9996}
    `('scales Math.random ($rnd) into [$a,$b)', ({ rnd, a, b, expected }) => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(rnd as number);
      const out = utils.randf(a as number, b as number);
      spy.mockRestore();
      expect(out).toBe(expected);
    });
  });

  describe('randi', () => {
    it.each`
      rnd       | a    | b    | expected
      ${0}      | ${2} | ${6} | ${2}
      ${0.9999} | ${2} | ${6} | ${5}
    `('scales Math.random ($rnd) into integer [$a,$b)', ({ rnd, a, b, expected }) => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(rnd as number);
      const out = utils.randi(a as number, b as number);
      spy.mockRestore();
      expect(out).toBe(expected);
    });
  });

  describe('randn', () => {
    it.each`
      mu | std | r1 | r2 | expected
      ${0} | ${1} | ${0.3} | ${0.4} | ${(() => {
  const u = -0.4,
    v = -0.2,
    r = u * u + v * v;
  const c = Math.sqrt((-2 * Math.log(r)) / r);
  return u * c;
})()}
      ${10} | ${2} | ${0.3} | ${0.4} | ${(() => {
  const u = -0.4,
    v = -0.2,
    r = u * u + v * v;
  const c = Math.sqrt((-2 * Math.log(r)) / r);
  return 10 + 2 * (u * c);
})()}
    `('mu=$mu std=$std with controlled Math.random', async ({ mu, std, r1, r2, expected }) => {
      const spy = vi.spyOn(Math, 'random');
      spy.mockReturnValueOnce(r1 as number).mockReturnValueOnce(r2 as number);
      vi.resetModules();
      const fresh = await import('./learning.utils');
      const out = fresh.randn(mu as number, std as number);
      spy.mockRestore();
      expect(Math.abs(out - (expected as number)) < 1e-12).toBe(true);
    });
  });

  describe('weightedSample', () => {
    it.each`
      p       | expected
      ${0.0}  | ${'a'}
      ${0.49} | ${'a'}
      ${0.5}  | ${'b'}
      ${0.9}  | ${'c'}
    `('selects correct item when randf=$p', ({ p, expected }) => {
      // weightedSample calls randf(0,1), which uses Math.random under the hood
      const spy = vi.spyOn(Math, 'random').mockReturnValue(p as number);
      const out = utils.weightedSample(['a', 'b', 'c'], [0.5, 0.3, 0.2]);
      spy.mockRestore();
      expect(out).toBe(expected);
    });
  });

  describe('getopt', () => {
    it.each`
      opt                       | field      | def    | expected
      ${{}}                     | ${'mode'}  | ${'A'} | ${'A'}
      ${{ mode: 'B' } as const} | ${'mode'}  | ${'A'} | ${'B'}
      ${{ count: 3 } as const}  | ${'count'} | ${1}   | ${3}
    `('returns opt[$field] or default', ({ opt, field, def, expected }) => {
      type Keys = 'mode' | 'count';
      const out = utils.getopt(opt as Record<Keys, unknown>, field as Keys, def as unknown);
      expect(out).toBe(expected);
    });
  });

  describe('gaussRandom', () => {
    it('returns cached second value based on first pair', async () => {
      // Chosen randoms so that r = u^2 + v^2 is within (0,1)
      // u = 2*0.3-1 = -0.4, v = 2*0.4-1 = -0.2, r = 0.2
      const spy = vi.spyOn(Math, 'random');
      spy.mockReturnValueOnce(0.3).mockReturnValueOnce(0.4);
      vi.resetModules();
      const fresh = await import('./learning.utils');
      const first = fresh.gaussRandom();
      const second = fresh.gaussRandom();

      const u = -0.4;
      const v = -0.2;
      const r = u * u + v * v; // 0.2
      const c = Math.sqrt((-2 * Math.log(r)) / r);
      const expected1 = u * c;
      const expected2 = v * c; // cached

      const eps = 1e-12;
      const ok = Math.abs(first - expected1) < eps && Math.abs(second - expected2) < eps;
      spy.mockRestore();
      expect(ok).toBe(true);
    });
  });
});
