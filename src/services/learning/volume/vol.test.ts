import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.restoreAllMocks();
});
describe('Vol', () => {
  it.each`
    name                        | data
    ${'from 1D array length 3'} | ${[1, 2, 3]}
    ${'from 1D array length 1'} | ${[42]}
  `('constructor $name', async ({ data }) => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const v = new Vol(data as number[], 0 as unknown as number, 0 as unknown as number);
    const snapshot = {
      sx: v.sx,
      sy: v.sy,
      depth: v.depth,
      w: Array.from(v.w as number[] | Float64Array),
      dw: (v.dw as number[] | Float64Array).length,
    };
    expect(snapshot).toEqual({
      sx: 1,
      sy: 1,
      depth: (data as number[]).length,
      w: data as number[],
      dw: (data as number[]).length,
    });
  });
  it.each`
    sx   | sy   | depth | c      | expectedLen
    ${1} | ${1} | ${1}  | ${0.0} | ${1}
    ${2} | ${3} | ${4}  | ${-2}  | ${24}
  `('constructor with dims sx=$sx sy=$sy depth=$depth and const c=$c', async ({ sx, sy, depth, c, expectedLen }) => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const v = new Vol(sx as number, sy as number, depth as number, c as number);
    const w = Array.from(v.w as number[] | Float64Array);
    const ok =
      v.sx === sx &&
      v.sy === sy &&
      v.depth === depth &&
      w.length === (expectedLen as number) &&
      w.every(x => x === (c as number));
    expect(ok).toBe(true);
  });
  it('random init uses gaussian with scale and caching', async () => {
    // Choose Math.random values that keep r in (0,1) to avoid recursion in gaussRandom
    // Pair1: r1=0.3 -> u=-0.4, r2=0.4 -> v=-0.2
    // Pair2: r3=0.9 -> u=-0.2, r4=0.2 -> v=-0.6
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.3).mockReturnValueOnce(0.4).mockReturnValueOnce(0.9).mockReturnValueOnce(0.2);
    vi.resetModules();
    const { Vol } = await import('./vol');
    const sx = 1,
      sy = 1,
      depth = 4; // n=4, scale = sqrt(1/(1*1*4)) = 0.5
    const v = new Vol(sx, sy, depth); // random init
    // reproduce expected using the same Box-Muller as in learning.utils.gaussRandom
    const scale = Math.sqrt(1.0 / (sx * sy * depth));
    function pair(uRand: number, vRand: number) {
      const u = 2 * uRand - 1;
      const vv = 2 * vRand - 1;
      const r = u * u + vv * vv;
      const c = Math.sqrt((-2 * Math.log(r)) / r);
      return [u * c, vv * c];
    }
    const [g0, g1] = pair(0.3, 0.4);
    const [g2, g3] = pair(0.9, 0.2);
    const expected = [g0 * scale, g1 * scale, g2 * scale, g3 * scale];
    const out = Array.from(v.w as number[] | Float64Array);
    spy.mockRestore();
    const eps = 1e-12;
    const ok = out.length === expected.length && out.every((x, i) => Math.abs(x - expected[i]) < eps);
    expect(ok).toBe(true);
  });
  it('indexing: get/set/add and grad ops work on flattened layout', async () => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const v = new Vol(2, 2, 2, 0.0);
    // set some values and grads
    v.set(0, 0, 0, 1);
    v.set(1, 0, 1, 2);
    v.add(0, 1, 0, 3); // becomes 3
    v.add(1, 1, 1, 4); // becomes 4
    v.set_grad(0, 0, 1, 10);
    v.add_grad(1, 0, 0, 5);
    v.add_grad(1, 1, 1, -2);
    const snapshot = {
      w: Array.from(v.w as number[] | Float64Array),
      dw: Array.from(v.dw as number[] | Float64Array),
      probe: [v.get(0, 0, 0), v.get(1, 0, 1), v.get_grad(1, 1, 1)],
    };
    // manual flattened order for 2x2x2: index = (sx*y + x)*depth + d
    expect(snapshot).toEqual({
      w: [1, 0, 0, 2, 3, 0, 0, 4],
      dw: [0, 10, 5, 0, 0, 0, 0, -2],
      probe: [1, 2, -2],
    });
  });
  it('clone and cloneAndZero preserve dims and copy/reset data', async () => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const v = new Vol(2, 1, 3, 0.0);
    const ww = v.w as number[] | Float64Array;
    ww[0] = 1;
    ww[1] = -1;
    ww[2] = 2;
    const c = v.clone();
    const z = v.cloneAndZero();
    const snapshot = {
      dimsClone: [c.sx, c.sy, c.depth],
      dimsZero: [z.sx, z.sy, z.depth],
      sameValues: Array.from(c.w as any),
      zeroValues: Array.from(z.w as any),
      referentiallyDifferent: c !== v && (c.w as any) !== (v.w as any) && (z.w as any) !== (v.w as any),
    };
    expect(snapshot).toEqual({
      dimsClone: [2, 1, 3],
      dimsZero: [2, 1, 3],
      sameValues: Array.from(v.w as any),
      zeroValues: [0, 0, 0, 0, 0, 0],
      referentiallyDifferent: true,
    });
  });
  it.each`
    name                         | aVals        | bVals             | scale        | expected
    ${'addFrom simple'}          | ${[1, 2, 3]} | ${[0.5, -0.5, 1]} | ${undefined} | ${[1.5, 1.5, 4]}
    ${'addFromScaled by factor'} | ${[1, 2, 3]} | ${[1, 1, 1]}      | ${2}         | ${[3, 4, 5]}
    ${'setConst overwrites'}     | ${[0, 0, 0]} | ${[0, 0, 0]}      | ${undefined} | ${[7, 7, 7]}
  `('arithmetic ops $name', async ({ aVals, bVals, scale, expected }) => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const a = new Vol(3, 1, 1, 0.0);
    const b = new Vol(3, 1, 1, 0.0);
    const aw = a.w as number[] | Float64Array;
    const bw = b.w as number[] | Float64Array;
    (aVals as number[]).forEach((v, i) => (aw[i] = v));
    (bVals as number[]).forEach((v, i) => (bw[i] = v));
    if (expected && (expected as number[]).every(v => v === 7)) {
      a.setConst(7);
    } else if (scale === undefined) {
      a.addFrom(b);
    } else {
      a.addFromScaled(b, scale as number);
    }
    const out = Array.from(a.w as number[] | Float64Array);
    expect(out).toEqual(expected as number[]);
  });
  it('toJSON/fromJSON roundtrip preserves dims and data', async () => {
    vi.resetModules();
    const { Vol } = await import('./vol');
    const v = new Vol(2, 2, 2, 3);
    const json = v.toJSON();
    const v2 = new Vol(1, 1, 1, 0);
    v2.fromJSON(json);
    const snapshot = {
      dims: [v2.sx, v2.sy, v2.depth],
      w: Array.from(v2.w as number[] | Float64Array),
    };
    expect(snapshot).toEqual({ dims: [2, 2, 2], w: Array.from(v.w as any) });
  });
});
